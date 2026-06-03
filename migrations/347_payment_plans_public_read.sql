-- 347_payment_plans_public_read.sql
--
-- BUG FIX: připojení splátkového plánu k objednávce (POST /api/buyer/orders/[id]/
-- payment-plan) běží v BUYER kontextu, ale catalog.payment_plans má jen
-- promotér-tenant policy → kupující plán NEVIDÍ → PLAN_NOT_FOUND (404), i když
-- plán existuje a je aktivní.
--
-- Splátkové plány jsou VEŘEJNÉ nabídky vázané na akci (kupující si musí vybrat,
-- stejně jako vidí ceny lístků). Přidáváme public SELECT policy pro aktivní plány.
-- Promotér-tenant policy dál řídí zápis (create/edit).

CREATE POLICY p_payment_plans_public_read ON catalog.payment_plans
  FOR SELECT USING (active = true);
