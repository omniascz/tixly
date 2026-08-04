--
-- 453_users_select_scoped.sql — zúžení `p_users_select` z `USING (true)`
--
-- ── Co se opravuje ───────────────────────────────────────────────────────────
-- `p_users_select` byla `FOR SELECT USING (true)`. Protože se PERMISSIVE
-- policies OR-ují, přebila i `p_users_write` — každé připojení s jakýmkoli GUC
-- kontextem přečetlo VŠECHNY řádky `identity.users`. Změřeno: tenant A viděl
-- řádky tenanta B (FINDINGS §34).
--
-- ── ⚠️ NEBYL to omyl, byl to vědomý kompromis ────────────────────────────────
-- Commit 5caf7c0 (mig 335) ho zavedl s odůvodněním: „identity.users měla
-- RLS=off, protože 91 routes JOINuje users kvůli jménu/emailu. Naivní
-- restriktivní RLS by je rozbila." Dnes je těch JOINů **126** ve 149 souborech,
-- takže tlak je ještě větší, ne menší.
--
-- Tahle migrace ten kompromis NERUŠÍ, jen ho zužuje z „kdokoli vidí kohokoli"
-- na „vidíš sebe + lidi, se kterými máš obchodní vztah".
--
-- ── Co NENÍ v ohrožení ───────────────────────────────────────────────────────
-- `password_hash` tady NEBYL a není: mig 335 ho přesunula do
-- `identity.user_secrets` (vlastní striktní policy `p_user_secrets_scope`,
-- ověřeno jako ÚČINNÁ) a trigger `trg_move_password` sloupec v `users` po
-- každém zápisu vynuluje. Login proto JOINuje `user_secrets`, ne `users`.
-- Uniká/uniklo: email, phone, name, birth_year, gender, country_code, city,
-- postal_code, stripe_customer_id — tedy PII, ne přihlašovací údaje.
--
-- ── Proč zrovna tyhle větve ──────────────────────────────────────────────────
--   app_is_service()          — interní/servisní kontext (login, webhooky, cron)
--   app_is_platform_admin()   — platformní administrace
--   id = app_current_user_id()— vlastní řádek (buyer cesty, /api/my/*)
--   zákazník promotéra        — přes orders → events; tohle drží 52 admin routes
--   člen promotéra            — platform.promoter_members (týmové výpisy)
--
-- ⚠️ VÝKON: policy se vyhodnocuje NA KAŽDÝ ŘÁDEK. Dvě EXISTS větve běží nad
--    orders/events. Před nasazením na data ověřit EXPLAIN na největším
--    promotérovi — na prázdné větvi se tohle nezměří.
--
-- NENASAZENO NA PRODUKCI.
--

BEGIN;

DROP POLICY IF EXISTS p_users_select ON identity.users;

CREATE POLICY p_users_select ON identity.users
  FOR SELECT
  USING (
    public.app_is_service()
    OR public.app_is_platform_admin()
    OR id = public.app_current_user_id()
    OR (
      public.app_current_promoter_id() IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM orders.orders o
        JOIN catalog.events e ON e.id = o.event_id
        WHERE o.user_id = users.id
          AND e.promoter_id = public.app_current_promoter_id()
      )
    )
    OR (
      public.app_current_promoter_id() IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM platform.promoter_members pm
        WHERE pm.user_id = users.id
          AND pm.promoter_id = public.app_current_promoter_id()
      )
    )
  );

COMMIT;
