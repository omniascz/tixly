-- Fáze 1 RLS/superuser nápravy (2026-06-01, audit P2).
-- App runtime přestává běžet jako superuser 'tixly'. Zavádí roli 'tixly_app'
-- (NOSUPERUSER) s granty na app schémata. BYPASSRLS ZÁMĚRNĚ ponechán — enforce RLS
-- je Fáze 2 (refaktor 431 raw-pool míst na context-aware přístup, viz security report).
-- Po aplikaci přepni DATABASE_URL na tixly_app. Pro existující DB; čisté DB to řeší
-- db/000_roles.sql + db/002_grants.sql přes docker init.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tixly_app') THEN
    CREATE ROLE tixly_app LOGIN PASSWORD 'tixly_app_dev';
  END IF;
END $$;
ALTER ROLE tixly_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
ALTER ROLE tixly_app PASSWORD 'tixly_app_dev';

DO $$
DECLARE s text;
BEGIN
  FOR s IN SELECT nspname FROM pg_namespace
           WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('information_schema')
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO tixly_app', s);
    EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO tixly_app', s);
    EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA %I TO tixly_app', s);
    EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO tixly_app', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE tixly IN SCHEMA %I GRANT ALL ON TABLES TO tixly_app', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE tixly IN SCHEMA %I GRANT ALL ON SEQUENCES TO tixly_app', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE tixly IN SCHEMA %I GRANT EXECUTE ON FUNCTIONS TO tixly_app', s);
  END LOOP;
END $$;
