--
-- reset-migration-ledger.sql — nakreslení čáry v evidenci migrací
--
-- ⚠️ NENÍ TO MIGRACE. Leží schválně v scripts/, ne v migrations/, aby ho
--    nemohl chytit žádný `migrations/*.sql` glob a spustit při deployi.
--
-- KONTEXT
-- Evidence `public.schema_migrations` má 245 řádků a končí na
-- `339_rls_submodule_tables_policies.sql`, zatímco schéma je reálně u ~449.
-- Migrace 340-449 se aplikovaly, aniž se zapsaly — CI smyčka v deploy.yml
-- do evidence nezapisuje vůbec (FINDINGS §17). Rekonstruovat těch ~110 řádků
-- zpětně by byla fikce, ne záznam.
--
-- ROZHODNUTO: nakreslí se čára. `000_baseline_20260730.sql` je snapshot
-- skutečného stavu produkce k 2026-07-30 a evidence začíná od něj.
--
-- POŘADÍ PŘI NASAZENÍ
--   1. 000_baseline_20260730.sql   (schéma)
--   2. 000_baseline_globals.sql    (role, granty, default privileges)
--   3. tenhle skript               (evidence)
--   4. 450 → 451 → 452
--
-- Na EXISTUJÍCÍ produkci se baseline NEAPLIKUJE (schéma už tam je) — spustí se
-- jen tenhle skript, aby evidence odpovídala realitě. Na čisté DB se aplikuje
-- všechno v uvedeném pořadí.
--
-- ⚠️ NEPOUŠTĚNO NA PRODUKCI. Testováno na ephemeral klonu.
--

BEGIN;

-- Tabulka musí odpovídat tvaru, který zakládá scripts/run-migrations.sh.
-- POZOR: `scripts/prod-migrate.mjs` a `prod-migrate-runner.mjs` čtou sloupec
-- `version`, který NEEXISTUJE — oba jsou rozbité (FINDINGS §16).
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  filename   TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Kolik řádků tu bylo před čárou — vypíše se do logu jako stopa.
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM public.schema_migrations;
  RAISE NOTICE 'schema_migrations před resetem: % řádků', n;
END $$;

DELETE FROM public.schema_migrations;

INSERT INTO public.schema_migrations (filename, applied_at) VALUES
  ('000_baseline_20260730.sql', NOW()),
  ('000_baseline_globals.sql',  NOW());

-- Kontrola: přesně 2 řádky, jinak transakce padne a nic se nezmění.
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM public.schema_migrations;
  IF n <> 2 THEN
    RAISE EXCEPTION 'schema_migrations má % řádků, čekány 2 — ROLLBACK', n;
  END IF;
  RAISE NOTICE 'schema_migrations po resetu: % řádky', n;
END $$;

COMMIT;
