-- =============================================================================
-- MIGRACE 003: Čárové kódy (Code 128) + SMS doručení vstupenek
-- Datum: 2026-04-04
-- Závisí na: 001_initial.sql (tickets.tickets tabulka)
-- =============================================================================

-- Přidej barcode_code do tickets
-- Formát: TK-{YEAR}-{6 číslic}-{2 velká alphanumerická} => délka 16 znaků, Code 128 kompatibilní
ALTER TABLE tickets.tickets
  ADD COLUMN barcode_code        TEXT UNIQUE,
  ADD COLUMN barcode_scanned_at  TIMESTAMPTZ,
  ADD COLUMN barcode_scanned_by  TEXT;  -- gate device ID, např. "gate-device-01"

COMMENT ON COLUMN tickets.tickets.barcode_code IS
  'Statický Code 128 čárový kód pro fyzické turnikety a ruční čtečky. Formát: TK-{YEAR}-{6 číslic}-{2 velká alphanumerická}. Anti-replay: po skenování se nastaví barcode_scanned_at.';
COMMENT ON COLUMN tickets.tickets.barcode_scanned_at IS
  'Timestamp prvního (a jediného platného) skenování čárového kódu. IS NOT NULL = vstupenka již použita.';
COMMENT ON COLUMN tickets.tickets.barcode_scanned_by IS
  'ID gate zařízení (turniketu) které vstupenku načetlo. Pro audit a přehled provozního personálu.';

-- Index pro rychlý lookup při skenování — turnikety skenují rychle, < 100ms musí být odpověď
CREATE UNIQUE INDEX idx_tickets_barcode_code
  ON tickets.tickets (barcode_code)
  WHERE barcode_code IS NOT NULL;

-- Short URL kód pro SMS odkaz (kratší než ticket UUID)
-- 8 znaků base62 (a-zA-Z0-9) = 62^8 ≈ 218 miliard kombinací
ALTER TABLE tickets.tickets
  ADD COLUMN short_code TEXT UNIQUE;  -- pro URL /e/{shortCode}

COMMENT ON COLUMN tickets.tickets.short_code IS
  '8-znakový base62 kód pro krátký URL odkaz na vstupenku. Např. tixly.cz/e/aB3xK9qR. Zasílán v SMS.';

CREATE UNIQUE INDEX idx_tickets_short_code
  ON tickets.tickets (short_code)
  WHERE short_code IS NOT NULL;

-- =============================================================================
-- SMS log — záznamy o odeslaných SMS notifikacích
-- =============================================================================

CREATE TABLE tickets.sms_log (
  id              BIGSERIAL    PRIMARY KEY,
  ticket_id       UUID         NOT NULL,  -- cross-schema odkaz bez FK
  phone           TEXT         NOT NULL,  -- E.164 formát, např. +420601234567
  message_sid     TEXT,                   -- Twilio Message SID (např. SM...)
  status          TEXT         NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'delivered', 'failed')),
  sent_at         TIMESTAMPTZ,
  error_message   TEXT,                   -- Chybová zpráva při status = 'failed'
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE tickets.sms_log IS
  'Log SMS notifikací pro vstupenky. Twilio delivery status callbacky aktualizují status. Phone je v plaintext E.164 — potřebujeme pro retry; pro GDPR se maže při anonymizaci uživatele.';
COMMENT ON COLUMN tickets.sms_log.ticket_id IS
  'UUID vstupenky z tickets.tickets; cross-schema reference — bez FK.';
COMMENT ON COLUMN tickets.sms_log.phone IS
  'Telefonní číslo v E.164 formátu (např. +420601234567). Uchovávat pro retry. GDPR: anonymizovat na NULL při výmazu uživatele.';
COMMENT ON COLUMN tickets.sms_log.message_sid IS
  'Twilio Message SID. NULL = SMS ještě nebyla odeslána (status=pending) nebo odeslání selhalo.';
COMMENT ON COLUMN tickets.sms_log.status IS
  'pending = vytvořeno, čeká na odeslání; sent = odesláno Twilio; delivered = potvrzeno doručení; failed = chyba.';

CREATE INDEX idx_sms_log_ticket
  ON tickets.sms_log (ticket_id);

CREATE INDEX idx_sms_log_status
  ON tickets.sms_log (status)
  WHERE status IN ('pending', 'failed');

CREATE INDEX idx_sms_log_created_at
  ON tickets.sms_log (created_at DESC);
