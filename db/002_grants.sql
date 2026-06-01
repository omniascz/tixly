-- Tixly — GRANTy pro runtime roli tixly_app (spustit AŽ PO db/baseline.sql).
-- tixly_app není superuser, takže potřebuje explicitní práva na app schémata.
-- Záměrně široké (ALL na tabulkách/sekvencích/funkcích) — cílem Fáze 1 je odebrat
-- SUPERUSER (cluster-admin práva), ne fine-grained table locking (to je možné později).
-- Idempotentní (GRANT je opakovatelný). ALTER DEFAULT PRIVILEGES pokryje budoucí objekty.

DO $$
DECLARE
  s text;
BEGIN
  FOR s IN
    SELECT nspname FROM pg_namespace
    WHERE nspname NOT LIKE 'pg_%'
      AND nspname NOT IN ('information_schema')
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO tixly_app', s);
    EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO tixly_app', s);
    EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA %I TO tixly_app', s);
    EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO tixly_app', s);
    -- budoucí objekty vytvořené rolí 'tixly' (migrace) automaticky dostanou granty
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE tixly IN SCHEMA %I GRANT ALL ON TABLES TO tixly_app', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE tixly IN SCHEMA %I GRANT ALL ON SEQUENCES TO tixly_app', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE tixly IN SCHEMA %I GRANT EXECUTE ON FUNCTIONS TO tixly_app', s);
  END LOOP;
END $$;
