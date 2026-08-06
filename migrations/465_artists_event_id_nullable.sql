--
-- 465_artists_event_id_nullable.sql — D10
--   lineups.artists.event_id: NOT NULL → NULLABLE
--
-- ── Proc ─────────────────────────────────────────────────────────────────────
-- `admin/artists` je promoter-level KATALOG umelcu: zaklada umelce bez vazby
-- na konkretni akci (`INSERT INTO lineups.artists (promoter_id, name, slug, …)`
-- — zadny `event_id`). Sloupec byl pritom NOT NULL, takze ta cesta padala.
-- Vazba umelce na akci se dela jinou tabulkou — `lineups.event_artists` —
-- a `admin/artists:39` uz dnes pocita `event_count` prave z ni.
--
-- ── Overeno, ze na NOT NULL nikdo nespoleha ──────────────────────────────────
-- Ctenari `lineups.artists`: admin/artists, admin/events/[id]/artists,
-- artists/[slug], buyer/artists, buyer/following, buyer/discover/events,
-- discover. Zadny z nich `a.event_id` nepouziva — vyskyty `event_id` v tech
-- souborech patri jinym tabulkam (`catalog.events`, `lineups.event_artists`).
-- `admin/events/[id]/artists:18` spojuje pres `a.id` a `a.promoter_id`, ne pres
-- `a.event_id`.
--
-- ── RLS drzi dal ─────────────────────────────────────────────────────────────
-- `lineups.artists` ma dve policy a OBE scopuji na `promoter_id`, ne na
-- `event_id`:
--   artists_public_select  FOR SELECT  (public OR promoter_id = … OR admin)
--   p_artists_tenant       FOR ALL     (admin OR promoter_id = … OR promoter_id IS NULL)
-- Zmena nullability `event_id` se jich tedy nedotyka a izolace plati i pro
-- zaznamy bez akce. Overeno merenim, ne uvahou.
--
-- ⚠️ Indexy `idx_artists_event_id` a `idx_artists_promoter_event` zustavaji —
-- NULL hodnoty v btree indexu vadi nevadi a index se po zaplneni event_id
-- (u zaznamu, ktere ho maji) pouziva dal.
--

BEGIN;

ALTER TABLE lineups.artists ALTER COLUMN event_id DROP NOT NULL;

COMMIT;
