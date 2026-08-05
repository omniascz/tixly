--
-- 460_ticket_alerts_service_branch.sql
--   marketing.ticket_alerts — SELECT policy nemá servisní větev
--
-- ── Co je špatně ─────────────────────────────────────────────────────────────
-- `events/[id]/alert` dělá `INSERT … RETURNING token`. Zápis prochází
-- (`ticket_alerts_insert` má `WITH CHECK (true)`), ale `RETURNING` spustí
-- SELECT vrstvu — a `ticket_alerts_select` má jen tři větve:
--   platform_admin  |  user_id = app_current_user_id()  |  (uuid)::text = ''
-- Anonymní přihlášení k hlídacímu psu (`user_id IS NULL`) neprojde žádnou.
--
-- ── Proč servisní větev, a ne větev na prázdný kontext ───────────────────────
-- Nabízelo se `app_current_user_id() IS NULL`. ZMĚŘENO, že to otevře tabulku:
--   ANONYM pod `IS NULL` vidí 3 ze 3 řádků včetně 3 cizích e-mailů.
-- Je to táž chyba, jakou má `USING (true)` — otevře tabulku všem cestám,
-- ne jen té jedné. Servisní větev je dosažitelná výhradně z kódu aplikace
-- (`runWithServiceContext`), takže rozhodnutí zůstává v routě, kde je vidět.
--
-- ── Co tahle migrace NEMĚNÍ ──────────────────────────────────────────────────
-- Zbylé tři větve zůstávají beze změny. Přihlášený uživatel po ní vidí pořád
-- jen svoje upozornění, anonymní spojení bez kontextu pořád nevidí nic.
-- Ověřeno testem, ne úvahou.
--
-- ⚠️ Třetí větev `(public.app_current_user_id())::text = ''::text` je MRTVÁ —
-- `app_current_user_id()` vrací uuid a to se prázdnému řetězci nerovná nikdy.
-- Původní tvar v baseline zněl `current_setting('app.user_id', true) = ''`
-- a byl mrtvý také: aplikace nastavuje `app.current_user_id`, ne `app.user_id`,
-- takže `current_setting` vracel NULL a `NULL = ''` je NULL, ne true.
-- Migrace 455 tedy tuhle větev NEZABILA — jen z náhodné mrtvoty udělala
-- strukturální. Nechávám ji tu úmyslně: odstranit ji je kosmetika, která by
-- v jedné migraci mísila opravu chování se změnou tvaru.
--

BEGIN;

DROP POLICY IF EXISTS ticket_alerts_select ON marketing.ticket_alerts;
CREATE POLICY ticket_alerts_select ON marketing.ticket_alerts
  FOR SELECT
  USING (
    (current_setting('app.is_platform_admin'::text, true) = 'true'::text)
    OR public.app_is_service()
    OR ((user_id IS NOT NULL) AND ((user_id)::text = (public.app_current_user_id())::text))
    OR ((public.app_current_user_id())::text = ''::text)
  );

COMMIT;
