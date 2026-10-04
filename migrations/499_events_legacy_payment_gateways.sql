-- 499_events_legacy_payment_gateways.sql
--   Kolo 7 / krok 6 — brány bez refundu přes API (Stripe, Mollie, PayPal, Przelewy24, Triple-A/krypto)
--   nejsou pro NOVÉ akce.
--
-- Refund přes bránu umí jen GoPay a ComGate (lib/payment/gateway-refund.ts; ostatní vrací
-- REFUND_UNSUPPORTED_PROVIDER). Peníze přijaté jinou bránou by při zrušení akce nešly vrátit.
--
-- catalog.events.legacy_payment_gateways:
--   false (výchozí, každá nová akce) → checkout tyto brány odmítne (lib/payment/gateway-policy.ts),
--   true → akce existovala před touto migrací; chování zůstává beze změny.
-- Migrace nastaví true všem akcím, které už existují (zpětná kompatibilita), a vypíše ty, které
-- tyto brány skutečně použily (objednávky s payment_provider mezi nimi) — viz ROUND7_REPORT.md.
-- Idempotentní: příznak se nastavuje jen při přidání sloupce.

DO $$
DECLARE
  added boolean := NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'catalog' AND table_name = 'events' AND column_name = 'legacy_payment_gateways');
  r record;
  n int := 0;
BEGIN
  IF added THEN
    ALTER TABLE catalog.events ADD COLUMN legacy_payment_gateways boolean NOT NULL DEFAULT false;
    UPDATE catalog.events SET legacy_payment_gateways = true;
  END IF;

  FOR r IN
    SELECT e.id, e.title, o.payment_provider, count(*) AS orders
      FROM catalog.events e
      JOIN orders.orders o ON o.event_id = e.id
     WHERE o.payment_provider IN ('stripe', 'mollie', 'paypal', 'przelewy24', 'crypto', 'triplea')
     GROUP BY e.id, e.title, o.payment_provider
     ORDER BY e.title
  LOOP
    n := n + 1;
    RAISE NOTICE 'akce s branou bez refundu: % (%) — % objednávek přes %', r.title, r.id, r.orders, r.payment_provider;
  END LOOP;
  RAISE NOTICE 'akcí s objednávkami přes brány bez refundu: %', n;
END $$;

COMMENT ON COLUMN catalog.events.legacy_payment_gateways IS
  'Kolo 7: true = akce existovala před mig. 499 a smí dál brány bez refundu přes API (Stripe, Mollie, PayPal, P24, Triple-A). Nové akce false.';
