-- =============================================================================
-- MIGRACE 051: Rozšíření tickets.ticket_transfer_log o audit fields
-- Datum: 2026-04-08
-- Důvod (Feature #47):
--   Pro escrow hold + buyer flow potřebujeme úplný audit trail TOTP rotace:
--     * nový (post-rotation) zašifrovaný secret pro vyšetřování disputů
--     * důvod rotace (resale_purchase | gift_transfer | admin_action)
--     * actor user id (kdo rotaci vyvolal — buyer / admin / systém)
--   Migrace 005 obsahovala pouze old_* sloupce (potřebné pro rollback).
--   Tato migrace je aditivní a zpětně kompatibilní — všechny nové sloupce
--   jsou NULLABLE a mají rozumný default tam, kde dává smysl.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Nové sloupce
-- ---------------------------------------------------------------------------
ALTER TABLE tickets.ticket_transfer_log
  ADD COLUMN IF NOT EXISTS new_totp_secret_encrypted BYTEA,
  ADD COLUMN IF NOT EXISTS new_totp_secret_iv        BYTEA,
  ADD COLUMN IF NOT EXISTS reason                    TEXT,
  ADD COLUMN IF NOT EXISTS actor_user_id             UUID;

-- Povolené hodnoty pro reason — chráníme proti překlepům a usnadňujeme reporting.
-- CHECK constraint je přidán pouze pokud ještě neexistuje.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ticket_transfer_log_reason_check'
  ) THEN
    ALTER TABLE tickets.ticket_transfer_log
      ADD CONSTRAINT ticket_transfer_log_reason_check
      CHECK (reason IS NULL OR reason IN ('resale_purchase', 'gift_transfer', 'admin_action'));
  END IF;
END;
$$;

COMMENT ON COLUMN tickets.ticket_transfer_log.new_totp_secret_encrypted IS
  'AES-256-GCM šifrovaný TOTP secret kupujícího po rotaci. Slouží pro forenzní audit.';

COMMENT ON COLUMN tickets.ticket_transfer_log.new_totp_secret_iv IS
  'IV (12B) k new_totp_secret_encrypted.';

COMMENT ON COLUMN tickets.ticket_transfer_log.reason IS
  'Důvod rotace: resale_purchase | gift_transfer | admin_action.';

COMMENT ON COLUMN tickets.ticket_transfer_log.actor_user_id IS
  'UUID uživatele, který rotaci vyvolal (buyer při resale, admin při manuální akci).';

-- ---------------------------------------------------------------------------
-- Index pro reportování podle důvodu (např. počet resale rotací za den)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_transfer_log_reason
  ON tickets.ticket_transfer_log(reason, transferred_at DESC);

-- ---------------------------------------------------------------------------
-- Ověření
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'tickets'
      AND table_name = 'ticket_transfer_log'
      AND column_name = 'new_totp_secret_encrypted'
  ), 'CHYBA: sloupec new_totp_secret_encrypted nebyl přidán';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'tickets'
      AND table_name = 'ticket_transfer_log'
      AND column_name = 'reason'
  ), 'CHYBA: sloupec reason nebyl přidán';

  RAISE NOTICE 'Migrace 051 úspěšně ověřena.';
END;
$$;

COMMIT;
