-- 358_performance_cast.sql
-- Per-performance obsazení herců (alternace zůstává skrytá přes is_visible)
-- Tabulka lineups.performance_cast linkuje artist na konkrétní event (reprízu),
-- s rolí, pořadím a příznakem viditelnosti (pro alternace nastavuje divadlo is_visible=false)

BEGIN;

CREATE TABLE IF NOT EXISTS lineups.performance_cast (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  artist_id       UUID REFERENCES lineups.artists(id) ON DELETE SET NULL,
  artist_name     TEXT NOT NULL,   -- free-text fallback když není artist profil
  role_name       TEXT NOT NULL,   -- "Romeo", "Dirigent", "Světla"
  photo_url       TEXT,
  bio_short       TEXT,
  is_understudy   BOOLEAN NOT NULL DEFAULT false,
  is_visible      BOOLEAN NOT NULL DEFAULT true,  -- false = alternace, skrytá veřejnosti
  order_index     INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_perf_cast_event ON lineups.performance_cast(event_id, order_index);

-- RLS: promotér spravuje jen vlastní akce
ALTER TABLE lineups.performance_cast ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'lineups'
      AND tablename  = 'performance_cast'
      AND policyname = 'perf_cast_promoter'
  ) THEN
    CREATE POLICY perf_cast_promoter ON lineups.performance_cast
      USING (event_id IN (
        SELECT e.id FROM catalog.events e
        JOIN platform.promoters p ON p.id = e.promoter_id
        WHERE p.id = current_setting('app.promoter_id', true)::uuid
      ));
  END IF;
END$$;

COMMIT;
