-- 286_app_role.sql
-- Vytvoří non-privileged `tixly_app` role pro app connections.
-- Bez tohoto: tixly (SUPERUSER + BYPASSRLS) skipuje všechny RLS policy → migrace
-- 285 byla aplikovaná ale neenforced.
--
-- Po této migraci:
--   - tixly = SUPERUSER, pro migrace / admin ops (PSQL handovers)
--   - tixly_app = NOSUPERUSER, NOBYPASSRLS — pro Next.js app connections
--   - Nastavit DATABASE_URL na postgres://tixly_app:<pwd>@... v Vercel env
--
-- LOCAL DEV: heslo default je `tixly_app_dev_pwd` (přepsat v staging/prod).

BEGIN;

-- Idempotent role create
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tixly_app') THEN
    CREATE ROLE tixly_app WITH LOGIN PASSWORD 'tixly_app_dev_pwd'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
    -- Explicit: NOBYPASSRLS je default, ale ujistit se
    ALTER ROLE tixly_app NOBYPASSRLS;
  END IF;
END $$;

-- GRANT na všechna existující + budoucí tabulky
GRANT USAGE ON SCHEMA
  accessibility, accreditation, ads, affiliate, ai_ads, ambassador, analytics,
  attribution, audit, auth, b2b, b2b_orders, benefit_payments, blacklist, catalog,
  channels, checkout, collab, comms, conference, cross_scanner, cs, discovery_feed,
  eventim_export, fan_share, flex_plans, identity, ignite, lineups, loyalty,
  marketing, monitoring, notifications, orders, partner, payments, platform, pos,
  promo, public, reservations, resale, retailer, revenue, risk, segmentation,
  sport, subscriptions, surveys, tickets, validation, venues, verified_fan
TO tixly_app;

-- Bulk GRANT SELECT/INSERT/UPDATE/DELETE napříč všemi schémami
DO $$
DECLARE
  s text;
BEGIN
  FOR s IN
    SELECT schema_name FROM information_schema.schemata
     WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO tixly_app',
      s
    );
    EXECUTE format(
      'GRANT USAGE ON ALL SEQUENCES IN SCHEMA %I TO tixly_app',
      s
    );
    EXECUTE format(
      'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO tixly_app',
      s
    );
    -- Default privileges pro budoucí tabulky vytvořené migrací (= ownerem tixly)
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tixly_app',
      s
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE ON SEQUENCES TO tixly_app',
      s
    );
  END LOOP;
END $$;

-- Pozn.: RLS je už ENABLE z migrace 285. Po této migraci se app musí připojit
-- jako tixly_app a před první query volat:
--   SET LOCAL app.current_promoter_id = '<uuid>';  -- pro promoter endpoints
--   SET LOCAL app.is_platform_admin = 'true';      -- pro platform admin
-- Bez set → RLS vrátí 0 rows.

COMMIT;
