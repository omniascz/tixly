-- 276_editorial_featured.sql
-- "Tipy redakce" — platform admin označuje akce jako featured.
-- Slouží jako content moat proti GoOut editorial section (curated discovery).

BEGIN;

ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS editorial_featured     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS editorial_featured_at  timestamptz,
  ADD COLUMN IF NOT EXISTS editorial_featured_by  uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS editorial_until        timestamptz,
  ADD COLUMN IF NOT EXISTS editorial_order        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS editorial_blurb        text;

CREATE INDEX IF NOT EXISTS idx_events_editorial_featured
  ON catalog.events(editorial_featured, editorial_order DESC, date_start ASC)
  WHERE editorial_featured = true;

COMMENT ON COLUMN catalog.events.editorial_featured IS 'Platform admin označil jako Tip redakce';
COMMENT ON COLUMN catalog.events.editorial_until IS 'Auto-unfeature po tomto datu (NULL = ručně)';
COMMENT ON COLUMN catalog.events.editorial_order IS 'Pořadí na homepage, vyšší = výše';
COMMENT ON COLUMN catalog.events.editorial_blurb IS 'Custom popis pro editorial section (override description)';

COMMIT;
