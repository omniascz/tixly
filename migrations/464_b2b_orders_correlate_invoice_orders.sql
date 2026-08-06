--
-- 464_b2b_orders_correlate_invoice_orders.sql
--   b2b_orders.dunning_log, b2b_orders.order_reservations — korelace mířila
--   na CIZÍ tabulku
--
-- ── Co je špatně (FINDINGS §110, R-18) ───────────────────────────────────────
-- Obě policy dělají
--     EXISTS (SELECT 1 FROM orders.orders o_ WHERE o_.id = <tbl>.order_id AND …)
-- jenže `order_id` je cizí klíč do `b2b_orders.invoice_orders`, ne do
-- `orders.orders`. Prostory ID se nepotkávají, takže `EXISTS` neplatí nikdy
-- a policy se smrskne na `app_is_platform_admin() OR app_is_service()`.
--
-- Odhalil to sken `scripts/fk-name-vs-target.mjs`, který porovnává JMÉNO sloupce
-- se skutečným `confrelid` — jmenná heuristika tuhle třídu najít neuměla.
--
-- ZMĚŘENO na klonu (naseedovaná faktura + řádek dunning logu):
--     owner (bypassrls)            vidí 1
--     promotér (vlastník faktury)  vidí 0   ← na SVŮJ vlastní dunning log
--     kupující                     vidí 0
--     servisní                     vidí 1
--
-- Je to FAIL-CLOSED: nedostupná funkce, ne únik. Promotér nevidí upomínky
-- ke svým vlastním B2B fakturám.
--
-- ── Oprava ───────────────────────────────────────────────────────────────────
-- `invoice_orders` má `promoter_id` přímo na řádku, takže korelace je jednoduchá
-- a bez druhé úrovně vnoření — vzorec `p_orders_scope` ze §81, jen přes rodiče.
-- Kupující větev (`o_.user_id = app_current_user_id()`) tu ZANIKÁ záměrně:
-- `invoice_orders` je fakturační objednávka firmy, nemá `user_id`; kdo za firmu
-- vidí, řeší B2B portál (R-17), ne tahle migrace.
--

BEGIN;

DROP POLICY IF EXISTS p_rls_dunning_log ON b2b_orders.dunning_log;
CREATE POLICY p_rls_dunning_log ON b2b_orders.dunning_log
  USING (
    public.app_is_platform_admin()
    OR public.app_is_service()
    OR EXISTS (
      SELECT 1 FROM b2b_orders.invoice_orders io
       WHERE io.id = dunning_log.order_id
         AND io.promoter_id = public.app_current_promoter_id()
    )
  );

DROP POLICY IF EXISTS p_rls_order_reservations ON b2b_orders.order_reservations;
CREATE POLICY p_rls_order_reservations ON b2b_orders.order_reservations
  USING (
    public.app_is_platform_admin()
    OR public.app_is_service()
    OR EXISTS (
      SELECT 1 FROM b2b_orders.invoice_orders io
       WHERE io.id = order_reservations.order_id
         AND io.promoter_id = public.app_current_promoter_id()
    )
  );

COMMIT;
