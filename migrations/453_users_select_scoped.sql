--
-- 453_users_select_scoped.sql — `p_users_select` rozdělena podle VZTAHU
--
-- ── Historie ─────────────────────────────────────────────────────────────────
-- Původně `FOR SELECT USING (true)` — každé připojení četlo všechny uživatele
-- (FINDINGS §34). První verze téhle migrace to zúžila na pět větví v JEDNÉ
-- policy, ale měření (§40, §41) ukázalo dva problémy:
--   • cesta přes `tickets` (dárek/transfer) zmizela → rozbitý scanner
--   • pod BUYER kontextem zbyl jen vlastní řádek → prázdný seznam přátel
--
-- ── Proč TŘI policies, a ne jedna s OR ───────────────────────────────────────
-- `identity.users` se čte ze dvou NEZÁVISLÝCH důvodů:
--   1. tenant scoping — promotér vidí své zákazníky, tým, držitele lístků
--   2. sociální graf  — kupující vidí své přátele a protistrany žádostí
-- Kdyby to byla jedna policy, každé rozšíření jedné strany by zvětšilo přístup
-- i na druhé (OR nerozlišuje, odkud větev přišla). Oddělené policies to
-- znemožňují STRUKTURÁLNĚ:
--   • Postgres permissive policies OR-uje sám, takže výsledek je totožný
--   • každou lze zvlášť zahodit, změnit a hlavně ZMĚŘIT (`pg_policies` je
--     ukáže jako tři řádky, takže je vidí i náš census/isolation harness)
--   • `identity.users` už tenhle vzor používá (`p_users_select`,
--     `p_users_write`, `p_users_promoter_insert`) — nezavádíme nový styl
--
-- Predikáty jsou v STABLE SQL helperech, aby se daly testovat samostatně
-- (`SELECT public.app_can_see_user_as_buyer(id) FROM …`) a aby je plánovač
-- mohl inlinovat — stejně jako stávající `app_*()` z migrace 285.
--
-- ── Co NEDĚLÁ ────────────────────────────────────────────────────────────────
-- Buyer větev je ZÁMĚRNĚ jen přátelství + čekající žádost. Rozšířit ji na
-- „kdokoli na stejné akci" by z ní udělalo díru — na jednu akci chodí tisíce
-- lidí, kteří o sobě nemají co vědět.
--
-- NENASAZENO NA PRODUKCI.
--

BEGIN;

-- ── 1) promotérský vztah ─────────────────────────────────────────────────────
-- zákazník (orders) │ člen týmu │ držitel lístku (i dárek/transfer) │
-- registrovaný verified-fan (ten objednávku ze své podstaty ještě nemá)
CREATE OR REPLACE FUNCTION public.app_can_see_user_as_promoter(target uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.app_current_promoter_id() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM orders.orders o
            JOIN catalog.events e ON e.id = o.event_id
            WHERE o.user_id = target AND e.promoter_id = public.app_current_promoter_id())
    OR EXISTS (SELECT 1 FROM platform.promoter_members pm
            WHERE pm.user_id = target AND pm.promoter_id = public.app_current_promoter_id())
    OR EXISTS (SELECT 1 FROM tickets.tickets tk
            JOIN orders.orders o2 ON o2.id = tk.order_id
            JOIN catalog.events e2 ON e2.id = o2.event_id
            WHERE tk.owner_id = target AND e2.promoter_id = public.app_current_promoter_id())
    OR EXISTS (SELECT 1 FROM marketing.verified_fan_requests vfr
            JOIN catalog.events e3 ON e3.id = vfr.event_id
            WHERE vfr.user_id = target AND e3.promoter_id = public.app_current_promoter_id())
  );
$$;

-- ── 2) sociální vztah ────────────────────────────────────────────────────────
-- `friendships` je symetrická (user_a/user_b), `friend_requests` směrová —
-- proto obě strany explicitně.
CREATE OR REPLACE FUNCTION public.app_can_see_user_as_buyer(target uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.app_current_user_id() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM social_graph.friendships f
            WHERE (f.user_a = public.app_current_user_id() AND f.user_b = target)
               OR (f.user_b = public.app_current_user_id() AND f.user_a = target))
    OR EXISTS (SELECT 1 FROM social_graph.friend_requests r
            WHERE r.status = 'pending' AND (
                 (r.from_user_id = public.app_current_user_id() AND r.to_user_id = target)
              OR (r.to_user_id   = public.app_current_user_id() AND r.from_user_id = target)))
  );
$$;

-- ── policies ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS p_users_select ON identity.users;
DROP POLICY IF EXISTS p_users_select_self ON identity.users;
DROP POLICY IF EXISTS p_users_select_promoter ON identity.users;
DROP POLICY IF EXISTS p_users_select_buyer ON identity.users;

-- vlastní řádek + servisní/platformní kontext (nepatří ani k jednomu vztahu)
CREATE POLICY p_users_select_self ON identity.users FOR SELECT
  USING (public.app_is_service()
      OR public.app_is_platform_admin()
      OR id = public.app_current_user_id());

CREATE POLICY p_users_select_promoter ON identity.users FOR SELECT
  USING (public.app_can_see_user_as_promoter(id));

CREATE POLICY p_users_select_buyer ON identity.users FOR SELECT
  USING (public.app_can_see_user_as_buyer(id));

COMMIT;
