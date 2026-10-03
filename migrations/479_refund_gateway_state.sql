-- 479_refund_gateway_state.sql  (kolo 3: přečíslováno z 472 — kolize s necommitnutou 472_royalty_agreements_currency.sql v tixly/)
-- FIX K2: refund musí projít platební bránou a stav 'refunded' se smí nastavit
-- AŽ po jejím potvrzení. K tomu:
--   1) dva mezistavy objednávky: 'refund_pending' (voláme bránu / čekáme na ni)
--      a 'refund_failed' (brána odmítla / timeout — refund je NUTNO řešit ručně/retry),
--   2) sloupce pro uložení odpovědi brány a chybového stavu.
-- Idempotentní: dá se pustit opakovaně i nad existujícím schématem.

BEGIN;

-- 1) Rozšířit povolené stavy objednávky o refund_pending / refund_failed.
ALTER TABLE orders.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders.orders ADD CONSTRAINT orders_status_check
  CHECK (status = ANY (ARRAY[
    'pending'::text, 'paid'::text, 'paid_partial'::text,
    'refund_pending'::text, 'refund_failed'::text,
    'cancelled'::text, 'refunded'::text, 'expired'::text, 'chargeback'::text
  ]));

-- 2) Stopa po volání brány (úspěch i chyba) — audit + možnost retry.
ALTER TABLE orders.orders
  ADD COLUMN IF NOT EXISTS refund_initiated_at   timestamptz,
  ADD COLUMN IF NOT EXISTS refund_completed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS refund_gateway_response jsonb,
  ADD COLUMN IF NOT EXISTS refund_error          text,
  ADD COLUMN IF NOT EXISTS refunded_amount_halire bigint;

COMMIT;
