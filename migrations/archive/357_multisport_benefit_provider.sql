-- 357_multisport_benefit_provider.sql
--
-- Přidává Multisport (BenefitSystems s.r.o.) jako platební metodu.
-- Multisport Kultura karta pokrývá divadelní a kulturní vstupenky.
--
-- Aktualizuje CHECK constrainty na:
--   1. orders.benefit_payments.provider
--   2. orders.orders.payment_provider

BEGIN;

-- 1) benefit_payments — přidej multisport do povoleného listu providerů
ALTER TABLE orders.benefit_payments
  DROP CONSTRAINT IF EXISTS benefit_payments_provider_check;

ALTER TABLE orders.benefit_payments
  ADD CONSTRAINT benefit_payments_provider_check
    CHECK (provider IN ('pluxee', 'benefit_plus', 'gallery_beta', 'edenred', 'multisport'));

-- 2) orders — přidej multisport do payment_provider allowlistu
ALTER TABLE orders.orders
  DROP CONSTRAINT IF EXISTS orders_payment_provider_check;

ALTER TABLE orders.orders
  ADD CONSTRAINT orders_payment_provider_check
    CHECK (payment_provider = ANY (ARRAY[
      'mock','gopay','comgate','stripe','wero','przelewy24','bank_transfer',
      'twisto','skippay','pluxee','sodexo','benefit_plus','edenred','multisport',
      'voucher','charity','free'
    ]));

COMMENT ON CONSTRAINT benefit_payments_provider_check ON orders.benefit_payments IS
  'CZ benefitní provideri: Pluxee/Sodexo, Benefit Plus, Gallery Beta, Edenred, Multisport (BenefitSystems).';

COMMIT;
