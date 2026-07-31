-- 444 — orders_payment_provider_check: doplnit 'comp' (komplementární/guest lístky).
-- Guestlist (admin přidání hosta) i comps feature zapisují orders.payment_provider='comp',
-- ale prod constraint ho nepovoloval → INSERT padal na check constraint. Aditivní rozšíření.
ALTER TABLE orders.orders DROP CONSTRAINT IF EXISTS orders_payment_provider_check;
ALTER TABLE orders.orders ADD CONSTRAINT orders_payment_provider_check
  CHECK (payment_provider IN (
    'mock','gopay','comgate','stripe','wero','przelewy24','bank_transfer',
    'twisto','skippay','pluxee','sodexo','benefit_plus','edenred','multisport',
    'voucher','charity','free','crypto','comp'
  ));
