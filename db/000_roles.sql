-- Tixly — DB role preamble (spustit PŘED db/baseline.sql)
-- baseline.sql obsahuje ~800 GRANT/RLS odkazů na roli tixly_app.
-- Tato role musí existovat dřív, než se baseline aplikuje.
-- Idempotentní: bezpečné spustit opakovaně.

-- Pozn.: tracking tabulku public.schema_migrations vytváří už samotný
-- db/baseline.sql (je součástí dumpu dev DB) — nezakládat ji zde, jinak
-- kolize "relation schema_migrations already exists" zastaví baseline.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tixly_app') THEN
    CREATE ROLE tixly_app NOLOGIN;
  END IF;
END $$;
