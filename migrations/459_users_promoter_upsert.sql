--
-- 459_users_promoter_upsert.sql — promotér smí dokončit guest upsert
--
-- ── Co je špatně ─────────────────────────────────────────────────────────────
-- `createOrGetGuestUser` dělá `INSERT … ON CONFLICT (email) DO UPDATE`.
-- Pro takový příkaz musí projít OBĚ policy vrstvy:
--   • INSERT větev  → `p_users_promoter_insert` (WITH CHECK: promotér je v kontextu) ✅
--   • UPDATE větev  → nad UŽ EXISTUJÍCÍM řádkem musí projít USING ❌
--
-- Jediná zapisovatelná policy `p_users_write` má
--   USING (app_is_service() OR app_is_platform_admin() OR id = app_current_user_id())
-- Admin cesty ale běží v `runAsActivePromoter` (nastaví `app.current_promoter_id`
-- a `app.role='promoter'`), takže ani jedna z těch tří větví neplatí →
--
--   42501 new row violates row-level security policy (USING expression) for table "users"
--
-- Je to táž mezera jako u `party_split_*` (§81): kontext, ve kterém route
-- reálně běží, nemá v policy žádnou větev. Tady navíc **asymetrická** —
-- promotér smí guesta vytvořit, ale ne dokončit upsert téhož guesta.
--
-- ── ⚠️ Co tahle migrace NEDĚLÁ: neruší ochranu z 453 ─────────────────────────
-- 453 zúžila ČTENÍ (`p_users_select_*`) tak, aby `identity.users` nebyla
-- čitelná celá. Tahle migrace se čtení **nedotýká** — přidává výhradně
-- `FOR UPDATE`. Tenant A tedy po ní pořád nevidí uživatele tenanta B.
-- Ověřeno testem, ne úvahou (izolační test v party-split i guest sadě).
--
-- ⚠️ Co ROZŠIŘUJE, a je potřeba to vědět: promotér v kontextu smí UPDATE
-- libovolného řádku `identity.users` — RLS je řádková, sloupce omezit neumí.
-- Je to táž míra důvěry, jakou už dnes dává `p_users_promoter_insert`
-- (promotér smí vložit libovolného uživatele). Zúžit to na "jen uživatelé,
-- které promotér už vidí" NEJDE: konfliktní řádek je typicky zákazník JINÉHO
-- promotéra, a právě proto ten upsert vzniká.
--
-- NENASAZENO NA PRODUKCI.
--

BEGIN;

DROP POLICY IF EXISTS p_users_promoter_upsert ON identity.users;
CREATE POLICY p_users_promoter_upsert ON identity.users
  FOR UPDATE
  USING (public.app_current_promoter_id() IS NOT NULL)
  WITH CHECK (public.app_current_promoter_id() IS NOT NULL);

COMMIT;
