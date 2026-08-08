--
-- 471_transit_passes_admin_guc_drift.sql — R-53
--   orders.transit_passes: administratorska vetev policy je MRTVA (drift jmena GUC)
--
-- ── Co bylo zmereno ──────────────────────────────────────────────────────────
-- transit_passes byla jedina NEJASNA policy z §108 — korelace na orders se tehdy
-- nenasla. Nasla se: `order_id IN (SELECT id FROM orders.orders WHERE user_id =
-- app_current_user_id())`, tedy jde o data KUPUJICIHO. Vlastnicka vetev byla
-- zmerena chovanim (§184, vzor 18): buyer sve vidi, cizi nevidi. Ta funguje.
--
-- ── Co je rozbite ────────────────────────────────────────────────────────────
-- Druha vetev cte `current_setting('app.platform_admin', true)`. Aplikace tenhle
-- GUC NENASTAVUJE NIKDE — standardni jmeno je `app.is_platform_admin` a cte se
-- pres helper `app_is_platform_admin()`. V celych migracich je `app.platform_admin`
-- (bez `is_`) prave JEDNOU, a to tady. Vetev je proto trvale false: platform admin
-- transit_passes nevidi.
--
-- Migrace 455 tuhle tridu driftu popsala jmenovite (`app.is_admin`,
-- `app.platform_admin`) a mela ji uzavrit — tenhle vyskyt ji unikl, protoze 455
-- resila schema `identity`, kdezto tahle policy je v `orders`.
--
-- ── Proc to NENI unik, ale funkcni mezera ────────────────────────────────────
-- Mrtva vetev nikoho nepousti navic, jen nepousti admina. Riziko je opacne, nez
-- u driftu obvykle: nezvysuje opravneni, snizuje. Opravuje se proto, ze policy
-- ma delat to, co je v ni napsane.
--
-- Smer je zamceny (§…): opravovat policies na `app_*()` helpery, ne obchazet je
-- v poolu. Servisni vetev se NEPRIDAVA — v puvodni policy nebyla a pridat ji by
-- znamenalo rozsirit pristup nad ramec toho, co autor napsal.
--

BEGIN;

DROP POLICY IF EXISTS transit_passes_buyer_owns ON orders.transit_passes;

CREATE POLICY transit_passes_buyer_owns ON orders.transit_passes
  USING (
    app_is_platform_admin()
    OR (order_id IN (SELECT o.id FROM orders.orders o WHERE o.user_id = app_current_user_id()))
  );

COMMIT;
