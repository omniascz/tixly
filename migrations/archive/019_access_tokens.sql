-- =============================================================================
-- MIGRACE 019: Access tokens — opakovaný NFC/QR přístup ke zdroji
-- Datum: 2026-04-06
-- Důvod:
--   Nový primitiv platformy: AccessToken = právo opakovaného přístupu
--   ke konkrétnímu zdroji v definovaném časovém okně.
--   Použití: hotelové klíče, coworking, car sharing, smart building access.
--
--   Odlišné od tickets.tickets:
--   - Ticket: jednorázový vstup na event (status → used po prvním scanu)
--   - AccessToken: N vstupů v okně valid_from..valid_until (status zůstává active)
--   - Jedna objednávka může mít N tokenů (jeden token = jeden host/uživatel)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. tickets.access_tokens
--    Hlavní tabulka přístupových tokenů.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets.access_tokens (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Vazba na objednávku — jedna booking může mít N tokenů (N hostů)
  booking_id              UUID        NOT NULL REFERENCES orders.orders(id) ON DELETE RESTRICT,

  -- Kdo token vlastní (ne nutně plátce — může být pozvaný host)
  holder_user_id          UUID        NOT NULL REFERENCES identity.users(id),

  -- Co odemyká (FK na catalog.events — pokoj/kancelář/auto jako event_type=space_rental)
  resource_id             UUID        NOT NULL REFERENCES catalog.events(id) ON DELETE RESTRICT,

  -- Lidsky čitelný popis zdroje pro zobrazení v app/wallet
  resource_label          TEXT        NOT NULL,   -- "Pokoj 112", "Kancelář A3", "BMW #5"

  -- Časové okno platnosti (check-in → check-out)
  valid_from              TIMESTAMPTZ NOT NULL,
  valid_until             TIMESTAMPTZ NOT NULL,

  -- TOTP secret pro QR variantu (AES-256-GCM, stejný vzor jako totp-qr modul)
  -- NULL pokud token používá pouze NFC HomeKey (bez QR fallback)
  totp_secret_encrypted   BYTEA,
  totp_secret_iv          BYTEA,

  -- Apple HomeKey / Google Hotel Key NFC payload (ECDH šifrovaný)
  -- NULL pro QR-only tokeny (Fáze 1)
  nfc_payload_encrypted   BYTEA,
  nfc_payload_iv          BYTEA,

  -- Stav tokenu
  status                  TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',    -- vydán, ale valid_from ještě nenastal
      'active',     -- v platném časovém okně
      'expired',    -- valid_until překročen (nebo extended_until)
      'revoked',    -- manuální revokace (ztracený telefon, spor, fraud)
      'extended'    -- late checkout — valid_until prodloužen
    )),

  -- Late checkout — prodloužení platnosti (addon objednávka)
  extended_until          TIMESTAMPTZ,
  extended_at             TIMESTAMPTZ,
  extended_by_user_id     UUID        REFERENCES identity.users(id),

  -- Re-issue při ztrátě telefonu — starý token ukazuje na nový
  replaced_by_token_id    UUID        REFERENCES tickets.access_tokens(id),

  -- Počítadlo použití (anti-abuse: rate limit X vstupů/hodinu)
  use_count               INTEGER     NOT NULL DEFAULT 0,
  last_used_at            TIMESTAMPTZ,

  -- Audit
  issued_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at              TIMESTAMPTZ,
  revoked_reason          TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_access_token_window
    CHECK (valid_until > valid_from),

  CONSTRAINT chk_access_token_extended
    CHECK (extended_until IS NULL OR extended_until > valid_until),

  CONSTRAINT chk_access_token_totp_pair
    CHECK (
      (totp_secret_encrypted IS NULL AND totp_secret_iv IS NULL)
      OR
      (totp_secret_encrypted IS NOT NULL AND totp_secret_iv IS NOT NULL)
    ),

  CONSTRAINT chk_access_token_nfc_pair
    CHECK (
      (nfc_payload_encrypted IS NULL AND nfc_payload_iv IS NULL)
      OR
      (nfc_payload_encrypted IS NOT NULL AND nfc_payload_iv IS NOT NULL)
    ),

  -- Token musí mít alespoň jednu auth metodu
  CONSTRAINT chk_access_token_has_auth
    CHECK (
      totp_secret_encrypted IS NOT NULL
      OR nfc_payload_encrypted IS NOT NULL
    )
);

COMMENT ON TABLE tickets.access_tokens IS
  'Opakovaný přístup ke zdroji v časovém okně (hotel, coworking, car sharing).
   Token zůstává platný přes N použití, nevyčerpá se (narozdíl od tickets.tickets).
   Jedna objednávka může mít N tokenů — každý host dostane vlastní.
   Verify endpoint musí odpovědět < 100ms (Redis cache).';

COMMENT ON COLUMN tickets.access_tokens.resource_id IS
  'FK na catalog.events — pokoj/kancelář/auto je modelován jako event_type=space_rental.
   resource_label je denormalizovaný label pro zobrazení bez JOIN.';

COMMENT ON COLUMN tickets.access_tokens.nfc_payload_encrypted IS
  'Apple HomeKey: ECDH šifrovaný payload pro NFC Express Mode.
   Vyžaduje Apple HomeKey partner certifikaci.
   NULL pro Fáze 1 (QR-only) a Fáze 2 (NFC relay).';

-- Indexy pro výkon
CREATE INDEX IF NOT EXISTS idx_access_tokens_booking_id
  ON tickets.access_tokens(booking_id);

CREATE INDEX IF NOT EXISTS idx_access_tokens_holder_user_id
  ON tickets.access_tokens(holder_user_id);

-- Hlavní index pro verify endpoint (< 100ms požadavek)
CREATE INDEX IF NOT EXISTS idx_access_tokens_resource_active
  ON tickets.access_tokens(resource_id, status, valid_from, valid_until)
  WHERE status IN ('pending', 'active');

-- Index pro cron job expiry checker
CREATE INDEX IF NOT EXISTS idx_access_tokens_expiry
  ON tickets.access_tokens(valid_until)
  WHERE status = 'active';

CREATE TRIGGER trg_access_tokens_updated_at
  BEFORE UPDATE ON tickets.access_tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. tickets.access_token_log
--    Audit log každého použití (vstup/výstup/odmítnutí).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets.access_token_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id        UUID        NOT NULL REFERENCES tickets.access_tokens(id) ON DELETE CASCADE,

  -- Typ události
  event_type      TEXT        NOT NULL
    CHECK (event_type IN (
      'entry',            -- vstup — zámek odemknut
      'exit',             -- výstup (volitelné — ne všechny zámky reportují)
      'denied',           -- odmítnut (expired/revoked/wrong_resource/invalid_totp)
      'extended',         -- late checkout schválen
      'revoked',          -- token revokován
      'replaced'          -- token nahrazen novým (ztracený telefon)
    )),

  resource_id     UUID        NOT NULL,

  -- ID fyzické čtečky/zámku (pro audit kdo, kde)
  reader_device_id TEXT,
  reader_location  TEXT,      -- "Reception", "Hlavní vchod", "Patro 3"

  -- Jak byl token prezentován
  auth_method     TEXT        NOT NULL
    CHECK (auth_method IN (
      'qr_totp',          -- QR kód z app
      'nfc_homekey',      -- Apple HomeKey Express Mode
      'nfc_relay',        -- NFC tag + API relay
      'manual_override'   -- personál odemkl manuálně
    )),

  -- Výsledek verify API
  http_status     INTEGER,    -- 200 = open, 403 = denied
  deny_reason     TEXT
    CHECK (deny_reason IS NULL OR deny_reason IN (
      'expired', 'revoked', 'wrong_resource',
      'invalid_totp', 'not_yet_valid', 'rate_limited'
    )),

  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE tickets.access_token_log IS
  'Immutable audit log každého použití access tokenu.
   Každý tap na NFC zámek nebo scan QR čtečkou = 1 záznam.
   Používá se pro bezpečnostní audit, billing (car sharing) a support.';

CREATE INDEX IF NOT EXISTS idx_access_token_log_token_id
  ON tickets.access_token_log(token_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_access_token_log_resource_recent
  ON tickets.access_token_log(resource_id, occurred_at DESC)
  WHERE event_type IN ('entry', 'denied');

-- ---------------------------------------------------------------------------
-- 3. Ověření
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'tickets'
      AND table_name = 'access_tokens'
  ), 'CHYBA: tickets.access_tokens neexistuje';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'tickets'
      AND table_name = 'access_token_log'
  ), 'CHYBA: tickets.access_token_log neexistuje';

  RAISE NOTICE 'Migrace 019 úspěšně ověřena — access tokens (NFC/QR) přidány.';
END;
$$;

COMMIT;
