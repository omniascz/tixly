-- 497_payouts_manual_transfer.sql
--   Kolo 7 / C-57 — výplaty pořadatelům: poctivý stav.
--
-- Dřív: CZK výplata „přes FIO" (lib/payouts/executor.ts) jen zapsala `processing` a výsledek hlásila jako
-- `paid`, peníze přitom neodešly (FIO Business API není napojené, převod dělá člověk v bankovnictví).
-- Stav `paid` šel zapsat bez jakéhokoli potvrzení.
--
-- 1) Nový stav `awaiting_manual_transfer` — výplata je spočítaná, převod musí udělat člověk.
-- 2) `paid` jen s potvrzením:
--      a) platform admin potvrdil ruční převod (transfer_confirmed_by/at, transfer_date, bank_reference), nebo
--      b) banka potvrdila převod (Wise webhook ověřený dotazem na Wise API: provider_confirmed_at).
--    Hlídá trigger trg_payouts_paid_guard → chyba PAYOUT_PAID_REQUIRES_CONFIRMATION (check_violation).
-- 3) Převod dat: neověřené `paid` a ruční FIO v `processing` → awaiting_manual_transfer, každý řádek
--    se zapíše do audit.platform_log. Ověřené Wise `paid` dostanou provider_confirmed_at.
-- Idempotentní (opakovaný běh nic nezmění).

ALTER TABLE platform.payouts
  ADD COLUMN IF NOT EXISTS transfer_date          date,
  ADD COLUMN IF NOT EXISTS transfer_confirmed_by  uuid REFERENCES identity.users(id),
  ADD COLUMN IF NOT EXISTS transfer_confirmed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS provider_confirmed_at  timestamptz;

ALTER TABLE platform.payouts DROP CONSTRAINT IF EXISTS payouts_status_check;
ALTER TABLE platform.payouts ADD CONSTRAINT payouts_status_check CHECK (status = ANY (ARRAY[
  'pending', 'approved', 'processing', 'awaiting_manual_transfer', 'paid', 'failed', 'cancelled'
]::text[]));

COMMENT ON COLUMN platform.payouts.transfer_date IS 'Datum ručního převodu potvrzené platform adminem (C-57).';
COMMENT ON COLUMN platform.payouts.transfer_confirmed_by IS 'Platform admin, který potvrdil ruční převod (C-57).';
COMMENT ON COLUMN platform.payouts.provider_confirmed_at IS 'Kdy banka/poskytovatel (Wise) potvrdil odeslání (C-57).';

-- Ověřené Wise výplaty (paid zapisuje jen webhook po dotazu na Wise API) → doplnit potvrzení poskytovatele.
UPDATE platform.payouts
   SET provider_confirmed_at = COALESCE(executed_at, paid_at, created_at)
 WHERE status = 'paid' AND payout_provider = 'wise' AND external_payout_id IS NOT NULL
   AND provider_confirmed_at IS NULL;

-- Neověřené paid → awaiting_manual_transfer (+ audit).
WITH reverted AS (
  UPDATE platform.payouts
     SET status = 'awaiting_manual_transfer', paid_at = NULL
   WHERE status = 'paid'
     AND provider_confirmed_at IS NULL
     AND NOT (transfer_confirmed_by IS NOT NULL AND transfer_confirmed_at IS NOT NULL
              AND transfer_date IS NOT NULL AND btrim(COALESCE(bank_reference, '')) <> '')
  RETURNING id, promoter_id, net_payout, currency
)
INSERT INTO audit.platform_log (actor_role, promoter_id, action, target_type, target_id, metadata)
SELECT 'migration', promoter_id, 'payout.unverified_paid_reverted', 'payout', id,
       jsonb_build_object('migration', '497', 'fromStatus', 'paid', 'toStatus', 'awaiting_manual_transfer',
                          'netPayout', net_payout, 'currency', currency)
  FROM reverted;

-- Ruční FIO v processing (peníze neodešly) → awaiting_manual_transfer (+ audit).
WITH moved AS (
  UPDATE platform.payouts
     SET status = 'awaiting_manual_transfer'
   WHERE status = 'processing' AND payout_provider = 'fio'
  RETURNING id, promoter_id, net_payout, currency
)
INSERT INTO audit.platform_log (actor_role, promoter_id, action, target_type, target_id, metadata)
SELECT 'migration', promoter_id, 'payout.manual_transfer_reclassified', 'payout', id,
       jsonb_build_object('migration', '497', 'fromStatus', 'processing', 'toStatus', 'awaiting_manual_transfer',
                          'netPayout', net_payout, 'currency', currency)
  FROM moved;

CREATE OR REPLACE FUNCTION platform.payouts_paid_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid') THEN
    IF NOT (
         (NEW.transfer_confirmed_by IS NOT NULL AND NEW.transfer_confirmed_at IS NOT NULL
          AND NEW.transfer_date IS NOT NULL AND btrim(COALESCE(NEW.bank_reference, '')) <> '')
      OR (NEW.payout_provider = 'wise' AND NEW.external_payout_id IS NOT NULL AND NEW.provider_confirmed_at IS NOT NULL)
    ) THEN
      RAISE EXCEPTION 'PAYOUT_PAID_REQUIRES_CONFIRMATION: výplata % smí do paid jen s potvrzením převodu (platform admin: datum + reference, nebo potvrzení banky)', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_payouts_paid_guard ON platform.payouts;
CREATE TRIGGER trg_payouts_paid_guard
  BEFORE INSERT OR UPDATE ON platform.payouts
  FOR EACH ROW EXECUTE FUNCTION platform.payouts_paid_guard();
