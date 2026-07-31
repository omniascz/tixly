-- 345_orders_payment_provider_free.sql
--
-- BUG FIX: POS prodej (walk-in pokladna) vytváří order s payment_provider='free'
-- (peníze inkasuje promotér u kasy, žádná online brána). Jenže
-- orders_payment_provider_check 'free' nepovolí → POS sale HTTP 500.
--
-- Přidáváme 'free' (offline/manuální kanál) do povolených hodnot.

ALTER TABLE orders.orders DROP CONSTRAINT IF EXISTS orders_payment_provider_check;
ALTER TABLE orders.orders ADD CONSTRAINT orders_payment_provider_check
  CHECK (payment_provider = ANY (ARRAY[
    'mock','gopay','comgate','stripe','wero','przelewy24','bank_transfer',
    'twisto','skippay','pluxee','sodexo','benefit_plus','edenred',
    'voucher','charity','free'
  ]));
