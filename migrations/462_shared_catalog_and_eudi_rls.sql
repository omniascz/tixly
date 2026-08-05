--
-- 462_shared_catalog_and_eudi_rls.sql
--   catalog.films, catalog.sport_teams — sdílený číselník (čtení sdílené, zápis vlastní)
--   identity.eudi_verifications        — servisní větev (zápis je anonymní)
--
-- Doplňuje 461, která pokryla 19 tabulek s přímým NOT NULL tenant sloupcem.
-- Tyhle tři měly NULLABLE sloupec, a proto čekaly na rozhodnutí (FINDINGS §107).
--
-- ── films / sport_teams: proč je USING širší než WITH CHECK ──────────────────
-- `promoter_id IS NULL` znamená GLOBÁLNÍ položku — film „Duna" nebo tým „Sparta"
-- je jeden pro všechny promotéry. Je to doložený záměr, ne nedopatření:
--   admin/films/route.ts:19   WHERE promoter_id = $1 OR promoter_id IS NULL
-- Promotér tedy globální položku VIDÍ, ale nesmí ji vytvořit ani změnit —
-- globální číselník spravuje platform admin. Proto:
--   USING       … OR promoter_id IS NULL      ← čtení sdílené
--   WITH CHECK  … BEZ IS NULL                 ← zápis jen vlastní
--
-- ⚠️ Tohle ZUŽUJE dnešní chování a je to ZÁMĚR. `admin/films/[id]` řádek 87
-- pouštěl UPDATE i na řádky s `promoter_id IS NULL`, zatímco DELETE (ř. 107)
-- jen na vlastní. Ta asymetrie je bug — kterýkoli promotér mohl přepsat
-- globální film všem ostatním. Kód se opravuje SPOLU s touhle migrací
-- (films/[id]:87 a sport-teams/[id]:89), aby aplikace a policy říkaly totéž.
--
-- ── eudi_verifications: proč servisní, a ne uživatelská větev ────────────────
-- `eudi/presentation-request/route.ts:59` zakládá řádek se sloupci
-- (request_id, event_id, order_id, status) — `user_id` se při zápisu
-- NEVYPLŇUJE VŮBEC, protože ověření identity běží PŘED přihlášením.
-- Uživatelská větev by proto nefungovala: v okamžiku zápisu žádný uživatel
-- neexistuje. Cesta se filtruje sama tokenem (`request_id`), takže platí týž
-- vzorec jako u veřejných rout ze §94 — servisní kontext, ne `USING (true)`.
-- `checkout/route.ts:424` už tu tabulku čte v servisním kontextu.
--

BEGIN;

-- ── catalog.films ────────────────────────────────────────────────────────────
ALTER TABLE catalog.films ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_films_scope ON catalog.films;
CREATE POLICY p_films_scope ON catalog.films
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id()
     OR promoter_id IS NULL)
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id());

-- ── catalog.sport_teams ──────────────────────────────────────────────────────
ALTER TABLE catalog.sport_teams ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_sport_teams_scope ON catalog.sport_teams;
CREATE POLICY p_sport_teams_scope ON catalog.sport_teams
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id()
     OR promoter_id IS NULL)
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id());

-- ── identity.eudi_verifications ──────────────────────────────────────────────
ALTER TABLE identity.eudi_verifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_eudi_verifications_scope ON identity.eudi_verifications;
CREATE POLICY p_eudi_verifications_scope ON identity.eudi_verifications
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR (user_id IS NOT NULL AND user_id = public.app_current_user_id()))
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR (user_id IS NOT NULL AND user_id = public.app_current_user_id()));

COMMIT;
