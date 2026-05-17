-- Event seats unique constraint: NULLS NOT DISTINCT
--
-- PostgreSQL default je NULLS DISTINCT — pro UNIQUE (event_id, event_day_id, sector, row, seat_number)
-- to znamená, že dva řádky s NULL event_day_id (single-day akce) jsou „různé" → constraint nezachytí
-- duplikáty. Opakované volání copy_layout_to_event_seats by tedy vyrobilo násobné kopie sedadel.
--
-- Tato migrace:
--   1) Pokud existuje stávající unique constraint na tomto klíči — DROP
--   2) Deduplikuj existující řádky (keep-first per klíč) — defenzivně, kdyby duplikáty už vznikly
--   3) ADD CONSTRAINT s NULLS NOT DISTINCT (PG 15+)
--
-- Idempotent: re-run skipne, pokud správný constraint už existuje.

BEGIN;

DO $$
DECLARE
  v_pg_major INTEGER;
  v_existing_constraint TEXT;
  v_has_correct_constraint BOOLEAN;
  v_dup_count INTEGER;
BEGIN
  -- Vyžaduje PostgreSQL 15+ (NULLS NOT DISTINCT syntax)
  SELECT setting::INTEGER INTO v_pg_major
    FROM pg_settings WHERE name = 'server_version_num';

  IF v_pg_major < 150000 THEN
    RAISE EXCEPTION 'Migrace 264 vyžaduje PostgreSQL 15+ kvůli NULLS NOT DISTINCT. Detected: %', v_pg_major;
  END IF;

  -- Pokud tabulka event_seats neexistuje, skip (může to být běh proti čisté DB)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'catalog' AND table_name = 'event_seats'
  ) THEN
    RAISE NOTICE 'catalog.event_seats neexistuje — migrace 264 přeskočena (čistá DB?)';
    RETURN;
  END IF;

  -- Najdi stávající unique constraint na očekávaných sloupcích
  SELECT con.conname INTO v_existing_constraint
  FROM pg_constraint con
  JOIN pg_class cls ON cls.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
  WHERE nsp.nspname = 'catalog'
    AND cls.relname = 'event_seats'
    AND con.contype = 'u'
    AND (
      SELECT array_agg(att.attname ORDER BY att.attnum)
      FROM unnest(con.conkey) AS k(attnum)
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
    ) @> ARRAY['event_id', 'sector', 'row', 'seat_number']::TEXT[]
  LIMIT 1;

  -- Detekce: má constraint NULLS NOT DISTINCT?
  IF v_existing_constraint IS NOT NULL THEN
    SELECT NOT con.connullsnotdistinct INTO v_has_correct_constraint
    FROM pg_constraint con
    WHERE con.conname = v_existing_constraint
    LIMIT 1;
    -- connullsnotdistinct = true znamená NULLS NOT DISTINCT
    -- (pojmenování v PG katalogu je obrácené proti SQL syntaxi)
    SELECT con.connullsnotdistinct INTO v_has_correct_constraint
    FROM pg_constraint con
    WHERE con.conname = v_existing_constraint;

    IF v_has_correct_constraint THEN
      RAISE NOTICE 'event_seats už má UNIQUE NULLS NOT DISTINCT (%) — migrace přeskočena.', v_existing_constraint;
      RETURN;
    END IF;

    -- Drop starý constraint
    RAISE NOTICE 'Dropping starý constraint: %', v_existing_constraint;
    EXECUTE 'ALTER TABLE catalog.event_seats DROP CONSTRAINT ' || quote_ident(v_existing_constraint);
  END IF;

  -- Defensivní dedup: keep-first per (event_id, COALESCE(event_day_id, '00000000-0000-0000-0000-000000000000'::uuid), sector, row, seat_number)
  WITH ranked AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY event_id, COALESCE(event_day_id, '00000000-0000-0000-0000-000000000000'::uuid), sector, row, seat_number
        ORDER BY created_at NULLS LAST, id
      ) AS rn
    FROM catalog.event_seats
  ),
  to_delete AS (
    SELECT id FROM ranked WHERE rn > 1
  )
  DELETE FROM catalog.event_seats WHERE id IN (SELECT id FROM to_delete);

  GET DIAGNOSTICS v_dup_count = ROW_COUNT;
  IF v_dup_count > 0 THEN
    RAISE NOTICE 'Smazáno % duplicitních sedadel před přidáním constraintu.', v_dup_count;
  END IF;

  -- Add nový constraint s NULLS NOT DISTINCT
  ALTER TABLE catalog.event_seats
    ADD CONSTRAINT uq_event_seats_position_nulls_not_distinct
    UNIQUE NULLS NOT DISTINCT (event_id, event_day_id, sector, row, seat_number);

  RAISE NOTICE 'Migrace 264 hotová: event_seats má teď UNIQUE NULLS NOT DISTINCT constraint.';
END $$;

COMMIT;
