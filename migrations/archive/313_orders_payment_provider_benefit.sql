-- 313_orders_payment_provider_benefit.sql
-- Rozšířit orders.payment_provider CHECK o benefit providery + bank_transfer + comgate.
-- Aktuální enum: gopay, stripe, przelewy24, free, wero
-- Přidat:        pluxee, sodexo, benefit_plus, gallery_beta, edenred, bank_transfer, comgate
--
-- Checkout/route.ts už tyto hodnoty posílá (paymentMethod enum), ale DB constraint
-- ji odmítal → 500 Internal Server Error. Migrace zacelí mezeru.

BEGIN;

ALTER TABLE orders.orders DROP CONSTRAINT IF EXISTS orders_payment_provider_check;
ALTER TABLE orders.orders ADD CONSTRAINT orders_payment_provider_check
  CHECK (payment_provider = ANY (ARRAY[
    'gopay',
    'comgate',
    'stripe',
    'free',
    'wero',
    'przelewy24',
    'bank_transfer',
    'pluxee',
    'sodexo',
    'benefit_plus',
    'gallery_beta',
    'edenred'
  ]));

COMMIT;
