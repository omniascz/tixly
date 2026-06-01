-- Test role pro validaci RLS enforce (Fáze 2, větev feature/rls-phase2-enforcement).
-- NOBYPASSRLS = RLS se VYNUCUJE (na rozdíl od produkční tixly_app, která má BYPASSRLS).
-- Dědí granty tixly_app přes členství. POUZE pro dev/staging testování enforce.
-- Spuštění: docker exec -i tixly-postgres psql -U tixly -d tixly < scripts/rls-test-role.sql
--
-- Použití (důkaz izolace):
--   docker exec tixly-postgres psql "postgresql://tixly_rls_test:rls_test@localhost:5432/tixly" \
--     -c "SET app.current_user_id='<uuid>'; SELECT COUNT(*) FROM orders.orders;"

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tixly_rls_test') THEN
    CREATE ROLE tixly_rls_test LOGIN PASSWORD 'rls_test' NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE tixly_rls_test LOGIN NOSUPERUSER NOBYPASSRLS;
ALTER ROLE tixly_rls_test PASSWORD 'rls_test';
GRANT tixly_app TO tixly_rls_test;
