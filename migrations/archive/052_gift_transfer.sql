-- =============================================================================
-- MIGRACE 052: Gift transfer ("Daruju vstupenku") — Feature #49
-- Datum: 2026-04-08
-- Důvod:
--   resale-api.gift-transfer.service.ts vyžaduje:
--     1) tickets.gift_transfer_log — záznam o darování (kdo komu, kdy, zpráva)
--     2) catalog.ticket_types.transferable — flag, jestli typ vstupenky
--        povoluje darování (organizátor může pro některé eventy zakázat).
--   Audit TOTP rotace běží přes existující tickets.ticket_transfer_log
--   (sdílený s resale flow), gift_transfer_log na něj odkazuje přes
--   transfer_log_id pro propojení obou auditních stop.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) catalog.ticket_types.transferable
-- ---------------------------------------------------------------------------
ALTER TABLE catalog.ticket_types
  ADD COLUMN IF NOT EXISTS transferable BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN catalog.ticket_types.transferable IS
  'Pokud FALSE, vstupenky tohoto typu nelze darovat (Feature #49). Default TRUE.';

-- ---------------------------------------------------------------------------
-- 2) tickets.gift_transfer_log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets.gift_transfer_log (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id        UUID         NOT NULL REFERENCES tickets.tickets(id) ON DELETE RESTRICT,
  transfer_log_id  UUID         REFERENCES tickets.ticket_transfer_log(id),
  from_user_id     UUID         NOT NULL,
  to_user_id       UUID         NOT NULL,
  message          TEXT,
  transferred_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE tickets.gift_transfer_log IS
  'Audit log darování vstupenek (Feature #49). Záznamy se nesmí mazat.
   Propojeno přes transfer_log_id na ticket_transfer_log s old/new TOTP secrets.';

CREATE INDEX IF NOT EXISTS idx_gift_transfer_to
  ON tickets.gift_transfer_log(to_user_id);

CREATE INDEX IF NOT EXISTS idx_gift_transfer_from
  ON tickets.gift_transfer_log(from_user_id);

CREATE INDEX IF NOT EXISTS idx_gift_transfer_ticket
  ON tickets.gift_transfer_log(ticket_id, transferred_at DESC);

-- ---------------------------------------------------------------------------
-- 3) Audit "reason" hodnota — ticket_transfer_log už podporuje 'gift_transfer'
--    skrze textový sloupec reason. Žádné CHECK constraint změny nejsou potřeba,
--    protože sloupec je volný TEXT.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE tickets.gift_transfer_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY gift_transfer_log_service_access ON tickets.gift_transfer_log
  FOR ALL
  USING (current_setting('app.role', TRUE) IN ('service', 'admin'));

-- ---------------------------------------------------------------------------
-- Ověření
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'tickets' AND table_name = 'gift_transfer_log'
  ), 'CHYBA: tickets.gift_transfer_log neexistuje';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'catalog'
      AND table_name = 'ticket_types'
      AND column_name = 'transferable'
  ), 'CHYBA: catalog.ticket_types.transferable neexistuje';

  RAISE NOTICE 'Migrace 052 úspěšně ověřena.';
END;
$$;

COMMIT;
