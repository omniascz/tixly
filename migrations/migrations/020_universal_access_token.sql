-- =============================================================================
-- MIGRACE 020: Generalizace AccessToken na univerzální primitivum
-- Datum: 2026-04-06
-- Důvod:
--   Strategická analýza (strategic-vision/ultimate-platform-vision.md) identifikovala
--   AccessToken jako klíčový primitiv pro desítky budoucích vertikál:
--   profesní licence, GDPR consent, uhlíkové kredity, IoT kvóty, vládní povolení.
--
--   Tato migrace rozšiřuje tickets.access_tokens z "hotelový klíč" na
--   plně polymorfní "digitální právo přístupu k jakémukoli zdroji".
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Polymorfní resource_type
--    Určuje sémantiku tokenu pro business logiku
-- ---------------------------------------------------------------------------
ALTER TABLE tickets.access_tokens
  ADD COLUMN IF NOT EXISTS resource_type TEXT NOT NULL DEFAULT 'space'
    CHECK (resource_type IN (
      'space',       -- fyzický prostor (pokoj, kancelář, auto) — původní použití
      'event',       -- vstup na konkrétní event (konference, lekce)
      'dataset',     -- přístup k datové sadě (výzkum, GDPR consent)
      'license',     -- softwarová nebo profesní licence
      'quota',       -- spotřební kvóta (rybářská, vodní, uhlíkový kredit)
      'permission',  -- povolení k činnosti (stavba, lov, let dronem)
      'credential',  -- certifikát nebo průkaz (diplom, certifikace)
      'compute',     -- výpočetní čas (GPU, QC slot)
      'service'      -- přístup ke službě (API calls, zdravotní výkon)
    ));

COMMENT ON COLUMN tickets.access_tokens.resource_type IS
  'Sémantický typ tokenu. Řídí business logiku ověření a audit reportování.
   space: hotel, coworking, auto (původní NFC use case).
   license: ČLK licence lékaře, software seat.
   quota: rybářská kvóta, uhlíkový kredit (decrements budget_remaining).
   compute: GPU/QC time slot.
   DEFAULT space zachovává kompatibilitu s existujícími záznamy.';

-- ---------------------------------------------------------------------------
-- 2. Budget counter pro kvóty a granty
--    Alternativa k max_uses pro měnové nebo fyzikální jednotky
-- ---------------------------------------------------------------------------
ALTER TABLE tickets.access_tokens
  ADD COLUMN IF NOT EXISTS budget_total BIGINT,
  ADD COLUMN IF NOT EXISTS budget_remaining BIGINT,
  ADD COLUMN IF NOT EXISTS budget_unit TEXT;  -- 'czk_halire', 'kg', 'm3', 'kwh', 'api_calls'

COMMENT ON COLUMN tickets.access_tokens.budget_total IS
  'Celkový rozpočet tokenu v daných jednotkách.
   NULL pro tokeny bez budgetového omezení (use max_uses místo toho).
   Příklady: 50000 (rybářská kvóta 500 kg při budget_unit=''kg''),
             1000000 (grant 10 000 Kč při budget_unit=''czk_halire'').';

COMMENT ON COLUMN tickets.access_tokens.budget_remaining IS
  'Zbývající nevyčerpaný budget. Atomicky decrementován při každém IoT/scan eventu.
   Stejný atomic decrement vzor jako season_passes.remaining_uses.';

COMMENT ON COLUMN tickets.access_tokens.budget_unit IS
  'Jednotka budgetu. Libovolný string — interpretace záleží na resource_type.
   Doporučené hodnoty: czk_halire, kg, m3, kwh, api_calls, minutes, items.';

-- ---------------------------------------------------------------------------
-- 3. Cross-tenant token verification
--    Vydavatel a ověřující entita mohou být různí tenanti
-- ---------------------------------------------------------------------------
ALTER TABLE tickets.access_tokens
  ADD COLUMN IF NOT EXISTS issuer_tenant_id UUID,     -- kdo vydal token
  ADD COLUMN IF NOT EXISTS verifier_tenant_id UUID;   -- kdo smí ověřovat (NULL = kdokoliv s API key)

COMMENT ON COLUMN tickets.access_tokens.issuer_tenant_id IS
  'UUID promotéra/tenanta, který token vydal.
   NULL = vydáno platformou samotnou (platform-level credential).
   Pro profesní licence: UUID tenanta ČLK nebo ČAK.
   Umožňuje cross-tenant verification: nemocnice ověří licenci vydanou ČLK.';

COMMENT ON COLUMN tickets.access_tokens.verifier_tenant_id IS
  'UUID tenanta, který smí token ověřovat.
   NULL = kdokoliv s platným API klíčem platformy.
   Pro přísné use cases (zdravotnictví, právo): nastavit na konkrétní tenant.';

-- ---------------------------------------------------------------------------
-- 4. Přenositelnost tokenu
--    Zda může být token převeden na jinou ověřenou identitu
-- ---------------------------------------------------------------------------
ALTER TABLE tickets.access_tokens
  ADD COLUMN IF NOT EXISTS transferable BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN tickets.access_tokens.transferable IS
  'Zda lze token převést na jinou ověřenou identitu (přes resale/transfer API).
   TRUE: hotelový klíč (lze předat kolegovi), softwarová licence (lze přeřadit).
   FALSE: profesní licence (osobní — nepřenositelná), recept (nepřenositelný).';

-- ---------------------------------------------------------------------------
-- 5. Domain-specific metadata
--    Atributy specifické pro daný resource_type
-- ---------------------------------------------------------------------------
ALTER TABLE tickets.access_tokens
  ADD COLUMN IF NOT EXISTS metadata JSONB;

COMMENT ON COLUMN tickets.access_tokens.metadata IS
  'Volné JSON pole pro domain-specific atributy.
   Příklady:
   license:    { "specialization": "kardiologie", "issuing_authority": "CLK" }
   quota:      { "species": "kapr", "water_body": "Vltava", "season": "2026" }
   compute:    { "gpu_model": "H100", "memory_gb": 80, "framework": "pytorch" }
   permission: { "drone_type": "DJI Mavic", "max_altitude_m": 120 }
   credential: { "degree": "MUDr.", "university": "UK Praha", "year": 2018 }';

-- ---------------------------------------------------------------------------
-- 6. IoT source flag
--    Označení, zda token může být ověřen IoT zařízením (ne jen mobilem/API)
-- ---------------------------------------------------------------------------
ALTER TABLE tickets.access_tokens
  ADD COLUMN IF NOT EXISTS iot_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS iot_device_whitelist TEXT[];  -- NULL = jakékoliv IoT zařízení

COMMENT ON COLUMN tickets.access_tokens.iot_enabled IS
  'TRUE = token může být ověřen/dekrementován IoT senzorem (čerpadlo, váha, průtokoměr).
   FALSE = pouze mobilní app nebo B2B API.
   Relevantní pro: vodní práva (průtokoměr), rybářské kvóty (váha na molu),
   EV nabíjení (nabíjecí stanice), GPU cluster (monitoring agent).';

COMMENT ON COLUMN tickets.access_tokens.iot_device_whitelist IS
  'Whitelist IoT device IDs, které smí dekrementovat budget.
   NULL = jakékoliv registrované IoT zařízení patřící issuer_tenant_id.
   Bezpečnostní prvek — zabraňuje podvodnému decrement z neautorizovaných senzorů.';

-- ---------------------------------------------------------------------------
-- 7. Rozšíření access_token_log pro IoT a budget events
-- ---------------------------------------------------------------------------
ALTER TABLE tickets.access_token_log
  ADD COLUMN IF NOT EXISTS budget_decrement BIGINT,  -- kolik bylo odečteno z budgetu
  ADD COLUMN IF NOT EXISTS budget_after BIGINT,      -- zbývající budget po dekrementu
  ADD COLUMN IF NOT EXISTS iot_device_id TEXT,       -- ID IoT senzoru (pokud IoT event)
  ADD COLUMN IF NOT EXISTS reading_value NUMERIC,    -- naměřená hodnota (kubiky, kg, kWh)
  ADD COLUMN IF NOT EXISTS reading_unit TEXT;        -- jednotka měření

-- Rozšíření event_type v access_token_log o IoT a budget events
-- (PostgreSQL neumí přidat hodnotu do CHECK constraintu bez ALTER)
-- Dynamicky nahradit CHECK constraint
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT tc.constraint_name INTO constraint_name
  FROM information_schema.table_constraints tc
  WHERE tc.table_schema = 'tickets'
    AND tc.table_name = 'access_token_log'
    AND tc.constraint_type = 'CHECK'
    AND tc.constraint_name LIKE '%event_type%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE tickets.access_token_log DROP CONSTRAINT ' || quote_ident(constraint_name);
  END IF;

  ALTER TABLE tickets.access_token_log
    ADD CONSTRAINT chk_access_token_log_event_type
    CHECK (event_type IN (
      'entry',            -- fyzický vstup (zámek odemknut)
      'exit',             -- výstup (volitelné)
      'denied',           -- odmítnut
      'extended',         -- late checkout
      'revoked',          -- revokace
      'replaced',         -- nahrazen novým tokenem
      'budget_decremented', -- IoT odečetl z budgetu (kvóta, grant)
      'budget_exhausted',   -- budget vyčerpán (token auto-expired)
      'transferred'         -- token převeden na jinou identitu
    ));

  RAISE NOTICE 'access_token_log event_type constraint aktualizován.';
END;
$$;

-- Rozšíření auth_method o IoT
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT tc.constraint_name INTO constraint_name
  FROM information_schema.table_constraints tc
  WHERE tc.table_schema = 'tickets'
    AND tc.table_name = 'access_token_log'
    AND tc.constraint_type = 'CHECK'
    AND tc.constraint_name LIKE '%auth_method%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE tickets.access_token_log DROP CONSTRAINT ' || quote_ident(constraint_name);
  END IF;

  ALTER TABLE tickets.access_token_log
    ADD CONSTRAINT chk_access_token_log_auth_method
    CHECK (auth_method IN (
      'qr_totp',          -- QR kód z app
      'nfc_homekey',      -- Apple HomeKey Express Mode
      'nfc_relay',        -- NFC tag + API relay
      'manual_override',  -- personál odemkl manuálně
      'iot_sensor',       -- IoT senzor (čerpadlo, váha, nabíječka)
      'api_b2b'           -- B2B API programatické ověření
    ));

  RAISE NOTICE 'access_token_log auth_method constraint aktualizován.';
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Nový index pro IoT queries
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_access_tokens_iot_enabled
  ON tickets.access_tokens(resource_type, iot_enabled, status)
  WHERE iot_enabled = TRUE AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_access_token_log_iot
  ON tickets.access_token_log(iot_device_id, occurred_at DESC)
  WHERE iot_device_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 9. Ověření
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'tickets'
      AND table_name = 'access_tokens'
      AND column_name = 'resource_type'
  ), 'CHYBA: tickets.access_tokens.resource_type neexistuje';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'tickets'
      AND table_name = 'access_tokens'
      AND column_name = 'budget_remaining'
  ), 'CHYBA: tickets.access_tokens.budget_remaining neexistuje';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'tickets'
      AND table_name = 'access_tokens'
      AND column_name = 'metadata'
  ), 'CHYBA: tickets.access_tokens.metadata neexistuje';

  RAISE NOTICE 'Migrace 020 úspěšně ověřena — universal AccessToken přidán.';
END;
$$;

COMMIT;
