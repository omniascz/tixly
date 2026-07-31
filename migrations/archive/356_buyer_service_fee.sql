-- 356_buyer_service_fee.sql
-- Service fee účtovaný koncovému zákazníkovi (buyer), konfigurovatelný master adminem.
--
-- Dosud: platform.fee_schedules.buyer_fee_halire šlo nastavit + UI ho zobrazovalo,
-- ale checkout ho NIKDY nepřičítal (no-op). Navíc price-preview počítal jiný
-- (hardcoded per-kanál %) "service fee", taky neúčtovaný. Sjednoceno na jeden
-- zdroj pravdy: buyer_fee_halire (fixní částka) + buyer_fee_basis (per_ticket|per_order).
--
-- 1) buyer_fee_basis: zda je fixní fee za každou vstupenku, nebo jednou za objednávku.
ALTER TABLE platform.fee_schedules
  ADD COLUMN IF NOT EXISTS buyer_fee_basis TEXT NOT NULL DEFAULT 'per_ticket'
    CHECK (buyer_fee_basis IN ('per_ticket', 'per_order'));

COMMENT ON COLUMN platform.fee_schedules.buyer_fee_basis IS
  'Jak se účtuje buyer_fee_halire: per_ticket (× počet vstupenek) nebo per_order (1× za objednávku).';

-- 2) orders.service_fee_minor: část total_amount, která je platform service fee.
--    Buyer ji zaplatí (je v total_amount), ale do promotérova gross/payoutu NESMÍ
--    — payout počítá promoter gross = total_amount − service_fee_minor.
ALTER TABLE orders.orders
  ADD COLUMN IF NOT EXISTS service_fee_minor INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN orders.orders.service_fee_minor IS
  'Service fee pro koncového zákazníka (součást total_amount). Platform revenue — vyloučeno z promotérova payout gross.';
