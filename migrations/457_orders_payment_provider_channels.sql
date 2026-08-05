--
-- 457_orders_payment_provider_channels.sql — doplnit chybějící PRODEJNÍ KANÁLY
--
-- ── Co se doplňuje a proč ────────────────────────────────────────────────────
-- `orders_payment_provider_check` (naposledy rozšířen migrací 451 o
-- `kiosk_card` a `reseller_cash`) nepovoluje několik hodnot, které kód
-- REÁLNĚ zapisuje. Každý takový zápis dnes skončí na `23514`.
--
--   b2b_credit   checkout/route.ts:2118, :2245 — B2B platba na kredit
--   mollie       party-split [token]/route.ts:121 — uživatelem volitelná metoda
--   paypal       tamtéž
--   box_office   prodej na pokladně (T-BOXOFFICE-RESTORE)
--   walkin       prodej na místě bez rezervace (T-WAITLIST-PROVIDER)
--   partner_pos  partnerský prodej (partner/sales)
--
-- ── ⚠️ ROZLIŠIT, NE SJEDNOTIT ────────────────────────────────────────────────
-- Nabízelo by se všechny pokladní kanály shrnout pod jednu hodnotu. NE:
-- `payment_provider` je jediné, čím se ty kanály v reportingu rozlišují
-- (`reports-prodeje.ts:123` staví dimenzi přímo z něj). Sjednocení by
-- historii zpětně slilo a už by nešlo rozdělit.
--
-- ── ⚠️ Co se ZÁMĚRNĚ NEDOPLŇUJE: `mock-gopay`, `mock-wero`, `mock-przelewy24`
-- Ty vrací mock platební brána (`lib/payment/provider.ts`) ve vývojovém
-- režimu. Do produkčního CHECKu NEPATŘÍ — je to artefakt dev prostředí, ne
-- prodejní kanál. Že se objevily v `orders`, byla chyba v kódu: party-split
-- ukládal `payment.provider` (hodnotu brány), zatímco hlavní checkout ukládá
-- `input.paymentMethod` (metodu zvolenou uživatelem). Opraveno v kódu, ne tady.
-- Viz FINDINGS §67.
--
-- NENASAZENO NA PRODUKCI.
--

BEGIN;

ALTER TABLE orders.orders DROP CONSTRAINT IF EXISTS orders_payment_provider_check;
ALTER TABLE orders.orders ADD CONSTRAINT orders_payment_provider_check
  CHECK (payment_provider IN (
    -- původní sada (baseline)
    'mock','gopay','comgate','stripe','wero','przelewy24','bank_transfer',
    'twisto','skippay','pluxee','sodexo','benefit_plus','edenred','multisport',
    'voucher','charity','free','crypto','comp',
    -- migrace 451 (POS)
    'kiosk_card','reseller_cash',
    -- tato migrace: platební metody, které kód nabízí, ale CHECK neznal
    'mollie','paypal','b2b_credit',
    -- tato migrace: prodejní kanály (rozlišené kvůli reportingu)
    'box_office','walkin','partner_pos'
  ));

COMMIT;
