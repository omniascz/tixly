-- 451 — orders_payment_provider_check: doplnit 'kiosk_card' + 'reseller_cash' (POS prodej).
-- kiosk/order (samoobslužný terminál, platba kartou) zapisuje payment_provider='kiosk_card',
-- reseller/sale (partner, hotovost u prodejce) zapisuje 'reseller_cash', ale prod constraint
-- ani jedno nepovoloval → INSERT padal na check constraint (23514) → objednávka nevznikla
-- (oba POS endpointy nikdy nefungovaly: blokoval je is_active drift + tento constraint).
-- Aditivní rozšíření výčtu, IDENTICKÝ vzor jako 444 (doplnění 'comp'). Hodnoty jsou write-only
-- labely (nikde se nečtou/nematchují), orders.orders je prázdná → nic se nerozbije.
ALTER TABLE orders.orders DROP CONSTRAINT IF EXISTS orders_payment_provider_check;
ALTER TABLE orders.orders ADD CONSTRAINT orders_payment_provider_check
  CHECK (payment_provider IN (
    'mock','gopay','comgate','stripe','wero','przelewy24','bank_transfer',
    'twisto','skippay','pluxee','sodexo','benefit_plus','edenred','multisport',
    'voucher','charity','free','crypto','comp','kiosk_card','reseller_cash'
  ));
