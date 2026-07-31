-- =============================================================================
-- MIGRACE 005: Vytvoření tickets.ticket_transfer_log
-- Datum: 2026-04-05
-- Důvod:
--   resale-api.resale-listing.service.ts zapisuje a čte z tabulky
--   tickets.ticket_transfer_log pro zálohu starého TOTP secretu při
--   purchaseListing. Při claim timeoutu (rollbackClaimTimeout) se z tohoto
--   logu načte původní secret a vstupenka se vrátí prodejci.
--   Bez této tabulky TOTP rotace a rollback selhávají na runtime DB error.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Tabulka: tickets.ticket_transfer_log
-- Immutable log TOTP rotací při resale — slouží pro rollback při claim timeoutu
-- Záznamy se NESMÍ mazat (audit trail, potenciální finanční dispute)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets.ticket_transfer_log (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Resale listing který spustil rotaci
  -- cross-schema reference na resale.resale_listings — bez FK (cross-schema)
  listing_id                UUID          NOT NULL,

  -- Vstupenka jejíž TOTP secret byl rotován
  ticket_id                 UUID          NOT NULL REFERENCES tickets.tickets(id) ON DELETE RESTRICT,

  -- Záloha původního TOTP secretu prodejce (AES-256-GCM šifrovaný)
  -- Použito při rollbacku, pokud kupující neklaímuje v CLAIM_WINDOW_MS
  old_totp_secret_encrypted BYTEA         NOT NULL,
  old_totp_secret_iv        BYTEA         NOT NULL,

  -- Čas rotace (kdy byl nový secret zapsán a kupujícímu otevřeno claim okno)
  transferred_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- Čas rollbacku — NULL pokud kupující úspěšně aktivoval vstupenku
  -- Nastaveno claimTimeoutJob při vypršení CLAIM_WINDOW_MS
  rolled_back_at            TIMESTAMPTZ
);

COMMENT ON TABLE tickets.ticket_transfer_log IS
  'Immutable log TOTP rotací při resale purchaseListing. Záznamy se nesmí mazat.
   Slouží pro rollback při claim timeoutu — pokud kupující neaktivuje vstupenku
   do CLAIM_WINDOW_MS (výchozí 4h), původní secret se obnoví a escrow se voiduje.';

COMMENT ON COLUMN tickets.ticket_transfer_log.listing_id IS
  'UUID resale inzerátu z resale.resale_listings; cross-schema, bez FK.';

COMMENT ON COLUMN tickets.ticket_transfer_log.old_totp_secret_encrypted IS
  'AES-256-GCM šifrovaný TOTP secret prodejce před rotací. Dešifrovatelný pouze klíčem z TOTP_ENCRYPTION_KEY.';

COMMENT ON COLUMN tickets.ticket_transfer_log.transferred_at IS
  'Kdy byla rotace provedena (začátek claim okna pro kupujícího).';

COMMENT ON COLUMN tickets.ticket_transfer_log.rolled_back_at IS
  'NULL = claim pending nebo úspěšně dokončen. NOT NULL = rollback byl proveden (timeout).';

-- ---------------------------------------------------------------------------
-- Indexy
-- ---------------------------------------------------------------------------

-- Primární přístup: načtení logu pro konkrétní listing (purchaseListing rollback)
CREATE INDEX IF NOT EXISTS idx_transfer_log_listing_id
  ON tickets.ticket_transfer_log(listing_id, transferred_at DESC);

-- Cleanup job: najít staré záznamy bez rollbacku starší než N dní
CREATE INDEX IF NOT EXISTS idx_transfer_log_ticket_id
  ON tickets.ticket_transfer_log(ticket_id, transferred_at DESC);

-- Monitoring: sledovat neukončené transfery
CREATE INDEX IF NOT EXISTS idx_transfer_log_pending
  ON tickets.ticket_transfer_log(transferred_at ASC)
  WHERE rolled_back_at IS NULL;

-- ---------------------------------------------------------------------------
-- RLS: stejná ochrana jako tickets.tickets — pouze service a admin vidí záznamy
-- ---------------------------------------------------------------------------
ALTER TABLE tickets.ticket_transfer_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY transfer_log_service_access ON tickets.ticket_transfer_log
  FOR ALL
  USING (current_setting('app.role', TRUE) IN ('service', 'admin'));

-- ---------------------------------------------------------------------------
-- Ověření
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'tickets'
      AND table_name = 'ticket_transfer_log'
  ), 'CHYBA: tickets.ticket_transfer_log neexistuje';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'tickets'
      AND table_name = 'ticket_transfer_log'
      AND column_name = 'old_totp_secret_encrypted'
  ), 'CHYBA: sloupec old_totp_secret_encrypted neexistuje';

  RAISE NOTICE 'Migrace 005 úspěšně ověřena.';
END;
$$;

COMMIT;
