-- RLS Fáze 2, Vlna C fix (větev): platform.promoters musí být veřejně ČITELNÝ.
-- Nález ze smoke: veřejný listing /cs/events dělá JOIN platform.promoters → pod
-- enforce anon neviděl žádného promotéra → INNER JOIN vrátil 0 → prázdný listing.
-- Promotér profil (jméno/slug/brand) je veřejný (zobrazuje se u každé akce + /p/[slug]).
--
-- Řešení: rozdělit na FOR SELECT (veřejné čtení) + FOR ALL (zápis jen admin/service/owner).
-- POZN. (review): RLS je row-level, ne column-level — anon tak teoreticky vidí i citlivé
-- sloupce (KYC/bank) crafted dotazem. App je veřejně nikdy neselectuje. Sloupcová izolace
-- (přesun citlivých sloupců do oddělené tabulky / public view) = samostatný follow-up.

DROP POLICY IF EXISTS p_promoters_scope ON platform.promoters;
DROP POLICY IF EXISTS platform_promoters_promoter ON platform.promoters;
DROP POLICY IF EXISTS p_promoters_read ON platform.promoters;
DROP POLICY IF EXISTS p_promoters_write ON platform.promoters;

CREATE POLICY p_promoters_read ON platform.promoters FOR SELECT
  USING (true);

CREATE POLICY p_promoters_write ON platform.promoters FOR ALL
  USING (app_is_platform_admin() OR app_is_service() OR id = app_current_promoter_id())
  WITH CHECK (app_is_platform_admin() OR app_is_service() OR id = app_current_promoter_id());
