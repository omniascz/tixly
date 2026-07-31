-- 320_bnpl_payment_providers.sql
-- CZ priority #2: BNPL Twisto + Skip Pay payment providers
--
-- Rozšíření orders.payment_provider CHECK constraint o 'twisto' + 'skippay'.
-- Mock režim (žádný TWISTO_API_KEY / SKIPPAY_API_KEY env) v dev — produkce
-- vyžaduje real provider integration (credit check + KYC).
--
-- Idempotent.

BEGIN;

ALTER TABLE orders.orders DROP CONSTRAINT IF EXISTS orders_payment_provider_check;
ALTER TABLE orders.orders
  ADD CONSTRAINT orders_payment_provider_check
  CHECK (payment_provider IN (
    'gopay', 'comgate', 'stripe', 'free',
    'wero', 'przelewy24', 'bank_transfer',
    'pluxee', 'sodexo', 'benefit_plus', 'gallery_beta', 'edenred',
    -- CZ BNPL providers (#320):
    'twisto', 'skippay'
  ));

COMMENT ON CONSTRAINT orders_payment_provider_check ON orders.orders IS
  'CZ BNPL twisto/skippay přidáno 2026-05-22 (CZ priority #2 z FR/UK/IT auditu)';

COMMIT;
