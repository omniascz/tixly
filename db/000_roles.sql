-- Tixly — DB role preamble (spustit PŘED db/baseline.sql)
-- baseline.sql obsahuje ~800 GRANT/RLS odkazů na roli tixly_app.
-- Tato role musí existovat dřív, než se baseline aplikuje.
-- Idempotentní: bezpečné spustit opakovaně.

-- Pozn.: tracking tabulku public.schema_migrations vytváří už samotný
-- db/baseline.sql (je součástí dumpu dev DB) — nezakládat ji zde, jinak
-- kolize "relation schema_migrations already exists" zastaví baseline.

-- tixly_app = runtime role aplikace (NE superuser). Cílem je, aby kompromitace
-- appky neznamenala plný přístup k clusteru (DROP DATABASE, ALTER SYSTEM, čtení
-- pg_authid, COPY z/do souborů, …). Migrace/seedy/ops dál běží jako 'tixly' (superuser).
-- BYPASSRLS je ZÁMĚRNĚ ponechán: enforce RLS je Fáze 2 (vyžaduje refaktor app na
-- context-aware přístup — viz db/security-rls-report.md). Do té doby chování = dnešní.
-- Dev heslo; v produkci nastav přes `ALTER ROLE tixly_app PASSWORD …` ze secretu.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tixly_app') THEN
    CREATE ROLE tixly_app LOGIN PASSWORD 'tixly_app_dev';
  END IF;
END $$;
ALTER ROLE tixly_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
-- Heslo nastavit bezpodmínečně (role mohla existovat bez hesla z dřívějška).
ALTER ROLE tixly_app PASSWORD 'tixly_app_dev';
