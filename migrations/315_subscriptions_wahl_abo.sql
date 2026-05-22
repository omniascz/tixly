-- 315_subscriptions_wahl_abo.sql
-- DACH parity #P0-2: Wahl-Abo (choice subscription) — buyer si vybere X
-- z N představení v package. Festabo (fixed) už funguje skrz subscriptions.packages
-- + auto-issue v confirm endpoint, tento patch přidává druhý mód.
--
-- Reservix pattern: Festabonnements (fixed) + Wahl-Abos (choice).
--
-- Backward-compatible: existující packages = fixed (default), žádné migrační
-- doplnění redemptions není potřeba.
--
-- Idempotent.

BEGIN;

ALTER TABLE subscriptions.packages
  ADD COLUMN IF NOT EXISTS abo_type text NOT NULL DEFAULT 'fixed';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'packages_abo_type_check'
  ) THEN
    ALTER TABLE subscriptions.packages
      ADD CONSTRAINT packages_abo_type_check
      CHECK (abo_type IN ('fixed', 'choice'));
  END IF;
END $$;

ALTER TABLE subscriptions.packages
  ADD COLUMN IF NOT EXISTS max_picks_for_choice integer;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'packages_max_picks_check'
  ) THEN
    ALTER TABLE subscriptions.packages
      ADD CONSTRAINT packages_max_picks_check
      CHECK (
        (abo_type = 'fixed' AND max_picks_for_choice IS NULL)
        OR (abo_type = 'choice' AND max_picks_for_choice > 0 AND max_picks_for_choice <= 365)
      );
  END IF;
END $$;

-- Restwert kredit (Q4 2026 follow-up): kolik kreditu má holder zbývající
-- z nevyčerpaných redemptions. V tomto patchi přidáme jen sloupec, business
-- logiku necháme do dalšího commitu (refund prorata už máme).
ALTER TABLE subscriptions.holders
  ADD COLUMN IF NOT EXISTS restwert_credit_halire integer NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'holders_restwert_check'
  ) THEN
    ALTER TABLE subscriptions.holders
      ADD CONSTRAINT holders_restwert_check
      CHECK (restwert_credit_halire >= 0);
  END IF;
END $$;

COMMENT ON COLUMN subscriptions.packages.abo_type IS
  'fixed = Festabonnement (auto-issue all events on payment); choice = Wahl-Abo (buyer picks max_picks_for_choice events)';
COMMENT ON COLUMN subscriptions.packages.max_picks_for_choice IS
  'For choice abo_type: how many events the holder may pick from package_events';
COMMENT ON COLUMN subscriptions.holders.restwert_credit_halire IS
  'Residual value credit (Reservix Restwert) — accumulated from cancelled redemptions, usable as voucher';

COMMIT;
