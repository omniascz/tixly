-- 302_unify_user_names.sql
-- Cleanup 3-column name layout v identity.users:
--   name (legacy aggregate) + first_name + last_name (modern split)
-- Po této migraci:
--   - first_name/last_name jsou source of truth
--   - name je auto-derived přes trigger (aplikace ho stále vidí, ale nemůže ji "rozejít")
--   - Backfill chybějících first_name/last_name z legacy `name` field
--
-- Audit pre-migration: 17/149 aktivních users mělo jen `name`, 0 konfliktů.

BEGIN;

-- ============================================================
-- 1. Backfill — split legacy `name` na first_name/last_name
-- ============================================================
-- Strategy: první slovo = first_name, zbytek = last_name.
-- "Jan Novák" → "Jan" + "Novák"
-- "Jan" → "Jan" + NULL
-- "Jan Pavel Novák" → "Jan" + "Pavel Novák"
UPDATE identity.users
SET
  first_name = split_part(name, ' ', 1),
  last_name = NULLIF(regexp_replace(name, '^[^\s]+\s*', ''), '')
WHERE name IS NOT NULL
  AND (first_name IS NULL OR last_name IS NULL)
  AND anonymized_at IS NULL;

-- ============================================================
-- 2. Sync trigger — first_name + last_name = source of truth,
--    `name` se auto-vypočítává.
-- ============================================================
CREATE OR REPLACE FUNCTION identity.sync_user_name()
RETURNS trigger AS $$
BEGIN
  -- Při INSERT/UPDATE syncujeme name z first_name + last_name (pokud existují).
  -- Pokud aplikace dodá jen `name` (legacy), naopak split a fill first/last.
  IF NEW.first_name IS NOT NULL OR NEW.last_name IS NOT NULL THEN
    NEW.name := TRIM(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, ''));
    IF NEW.name = '' THEN NEW.name := NULL; END IF;
  ELSIF NEW.name IS NOT NULL AND NEW.first_name IS NULL AND NEW.last_name IS NULL THEN
    -- Legacy code-path: aplikace dodá jen `name` → rozdělíme
    NEW.first_name := split_part(NEW.name, ' ', 1);
    NEW.last_name := NULLIF(regexp_replace(NEW.name, '^[^\s]+\s*', ''), '');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_user_name ON identity.users;
CREATE TRIGGER trg_sync_user_name
  BEFORE INSERT OR UPDATE OF name, first_name, last_name ON identity.users
  FOR EACH ROW
  EXECUTE FUNCTION identity.sync_user_name();

-- ============================================================
-- 3. Comment columns to document the new source of truth
-- ============================================================
COMMENT ON COLUMN identity.users.first_name IS
  'Source of truth pro křestní jméno. Sync trigger auto-updates name = first_name || last_name.';
COMMENT ON COLUMN identity.users.last_name IS
  'Source of truth pro příjmení.';
COMMENT ON COLUMN identity.users.name IS
  'Auto-derived z first_name + last_name přes trigger trg_sync_user_name. NEPIŠ přímo — používej first_name/last_name.';

INSERT INTO public.schema_migrations (filename)
VALUES ('302_unify_user_names.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
