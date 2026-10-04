-- scripts/prod/preflight.sql — kontroly PŘED nasazením (kolo 9 / krok 5). POUZE PRO ČTENÍ.
--
-- Spuštění (owner URL produkce, z bezpečného stroje vlastníka):
--   psql "$PROD_OWNER_URL" -v ON_ERROR_STOP=1 -f scripts/prod/preflight.sql > preflight-$(date +%F).txt
-- Celý skript běží v transakci READ ONLY — žádný příkaz nic nezmění (zápis by skončil chybou).
-- Očekávané hodnoty níže pocházejí z databáze postavené od nuly z migrací 000–506 (integrate/2026-10-04);
-- produkce, která ještě nemá migrace 500–506, ukáže méně politik/tabulek — viz bod 4 a GO-LIVE-RUNBOOK.md.
\set ON_ERROR_STOP on
\pset footer off
BEGIN TRANSACTION READ ONLY;

\echo '== 1) Role a atributy'
-- Očekávání: tixly_app existuje, rolcanlogin=t, rolsuper=f, rolbypassrls=f, rolcreaterole=f, rolcreatedb=f.
--            Vlastník migrací (neondb_owner) existuje; na Neonu není superuser (rolsuper=f).
SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
  FROM pg_roles WHERE rolname IN ('tixly_app', 'neondb_owner', current_user) ORDER BY rolname;
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tixly_app') THEN 'CHYBA: role tixly_app neexistuje'
            WHEN (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = 'tixly_app') THEN 'CHYBA: tixly_app obchází RLS'
            ELSE 'OK: tixly_app NOBYPASSRLS, NOSUPERUSER' END AS kontrola_tixly_app;

\echo '== 2) RLS zapnutá na tabulkách'
-- Očekávání (stav po migraci 506): 617 tabulek, 589 s RLS, 28 bez RLS = přesně tento seznam (číselníky, systémové):
--   b2b.sandbox_fixtures benefit_payments.providers brands.advertisers brands.campaigns catalog.moderation_blocklist
--   channels.channel_providers marketing.editorial_articles marketing.transit_partners marketing.web_vitals
--   monitoring.status_incidents monitoring.system_components platform.config platform.currencies platform.dashboard_widgets
--   platform.exchange_rates platform.incident_updates platform.incidents public.admin_audit_log
--   public.admin_impersonation_tokens public.feature_flags_audit public.schema_migrations public.spatial_ref_sys
--   public.wallet_device_registrations public.wallet_pass_updates public.wallet_passes_data resources.resource_hub
--   risk.fraud_rules risk.velocity_limits
SELECT count(*) AS tabulek,
       count(*) FILTER (WHERE c.relrowsecurity) AS s_rls,
       count(*) FILTER (WHERE NOT c.relrowsecurity) AS bez_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast');
SELECT n.nspname || '.' || c.relname AS tabulka_bez_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r', 'p') AND NOT c.relrowsecurity AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
 ORDER BY 1;

\echo '== 3) Počet politik vs. migrace'
-- Očekávání: 871 po migraci 506 (nextjs-boilerplate/rls-snapshot.json). Méně = chybí migrace (bod 4).
SELECT count(*) AS politik FROM pg_policies;

\echo '== 4) Poslední aplikovaná migrace'
-- Očekávání před nasazením kol 7–9: poslední je nižší než 493 (produkce má mig do ~480, viz paměť projektu);
-- seznam CHYBĚJÍCÍCH vypíše scripts/prod/pending-migrations.sh (porovná soubory v migrations/ s touto tabulkou).
SELECT CASE WHEN to_regclass('public.schema_migrations') IS NULL THEN 'tabulka schema_migrations neexistuje'
            ELSE 'schema_migrations existuje' END AS stav;
SELECT max(filename) AS posledni, count(*) AS aplikovano FROM public.schema_migrations;

\echo '== 5) SECURITY DEFINER funkce (žádný bypass RLS)'
-- Očekávání: přesně těchto 7 (jsou v migracích a záměrně definer — čtou/zapisují úzce vymezená data):
--   catalog.event_vat_readiness, identity.anonymize_user, identity.move_password_to_secrets,
--   marketing.cleanup_expired_spotify_oauth, public.app_can_see_user_as_buyer, public.app_can_see_user_as_promoter,
--   public.audit_trigger_func
-- Cokoli dalšího = neschválený bypass → STOP, prověřit.
SELECT n.nspname || '.' || p.proname AS security_definer
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema')
 ORDER BY 1;
-- Funkce, které by v DB přepínaly kontext na admin/systém (app.is_platform_admin=true, app.role) — očekávání: jen
-- public.app_is_platform_admin (pouze ČTE nastavení). Kód aplikace to dělá v transakci (asSystemInTx), ne v DB funkcích.
SELECT n.nspname || '.' || p.proname AS prepina_kontext
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
   AND (p.prosrc ILIKE '%app.is_platform_admin%true%' OR p.prosrc ILIKE '%set_config(''app.role''%')
 ORDER BY 1;

\echo '== 6) Práva tixly_app (vzorek) a TRUNCATE'
-- Očekávání: SELECT/INSERT na orders.orders = t; TRUNCATE na nových tabulkách kola 8 = f.
SELECT has_table_privilege('tixly_app', 'orders.orders', 'SELECT') AS orders_select,
       has_table_privilege('tixly_app', 'orders.orders', 'INSERT') AS orders_insert,
       CASE WHEN to_regclass('orders.seat_reservations') IS NULL THEN NULL
            ELSE has_table_privilege('tixly_app', 'orders.seat_reservations', 'TRUNCATE') END AS seat_reservations_truncate;

ROLLBACK;
\echo '== hotovo (jen čtení, nic nezměněno)'
