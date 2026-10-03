--
-- 492_subscription_holders_protected_columns.sql
--   subscriptions.holders — kupec nesmí měnit peněžní a stavové sloupce (FIX_REPORT_R3 bod 4)
--
-- ── Co bylo změřeno (tests/fix-r4-holders-guard.live.test.ts) ───────────────
-- Jediná politika `p_scope` (ALL) pouští kupce na VLASTNÍ řádek (user_id = kupec). RLS ale
-- hlídá řádky, ne sloupce: kupec si pod svým kontextem přepsal restwert_credit_halire
-- (kredit, kterým se platí v checkoutu), stav, platnost i platební údaje abonentky.
--
-- ── Oprava ───────────────────────────────────────────────────────────────────
-- Stejný vzor jako 486 (orders/tickets): BEFORE UPDATE trigger, chráněné sloupce smí měnit
-- jen app_may_write_protected() (servis/system, platform admin, pořadatel, BYPASSRLS role).
-- Legitimní zápisy těchto sloupců už běží servisně nebo přes asSystemInTx (pick, checkout,
-- potvrzení platby). Kupec dál mění údaje držitele, preferované místo/zónu a preferenci obnovení.
-- Idempotentní.
--
BEGIN;

CREATE OR REPLACE FUNCTION subscriptions.holders_guard_protected()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.app_may_write_protected() THEN
    RETURN NEW;
  END IF;
  IF NEW.package_id IS DISTINCT FROM OLD.package_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
     OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
     OR NEW.price_paid_halire IS DISTINCT FROM OLD.price_paid_halire
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
     OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
     OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
     OR NEW.payment_provider IS DISTINCT FROM OLD.payment_provider
     OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
     OR NEW.restwert_credit_halire IS DISTINCT FROM OLD.restwert_credit_halire
  THEN
    RAISE EXCEPTION 'subscriptions.holders: chráněný sloupec smí měnit jen servis/pořadatel'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_holders_guard_protected ON subscriptions.holders;
CREATE TRIGGER trg_holders_guard_protected
  BEFORE UPDATE ON subscriptions.holders
  FOR EACH ROW EXECUTE FUNCTION subscriptions.holders_guard_protected();

COMMIT;
