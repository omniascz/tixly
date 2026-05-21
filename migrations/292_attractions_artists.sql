-- 292_attractions_artists.sql
-- TM Parity Fáze 2: Attraction & Artist Management
--
-- TM-style: jeden artist/attraction může být napříč více events (tour, festival lineup).
-- Update jednou → propagace na všechna spojená events (cover, bio, social links).
--
-- Pozn.: Existuje už `lineups.artists` z migrace 233. Tato migrace rozšiřuje.

BEGIN;

-- Rozšířit existing lineups.artists pokud chybí klíčové sloupce
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'lineups' AND table_name = 'artists'
  ) THEN
    CREATE TABLE lineups.artists (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      promoter_id uuid REFERENCES platform.promoters(id) ON DELETE CASCADE,
      name        text NOT NULL,
      slug        text,
      bio         text,
      cover_image_url text,
      genres      text[] NOT NULL DEFAULT '{}',
      country     text,
      website_url text,
      social_links jsonb NOT NULL DEFAULT '{}',
      spotify_id  text,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    );
  END IF;
END $$;

-- Doplnit chybějící sloupce (idempotent)
ALTER TABLE lineups.artists
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS cover_image_url text,
  ADD COLUMN IF NOT EXISTS genres text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS website_url text,
  ADD COLUMN IF NOT EXISTS social_links jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS spotify_id text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_artists_promoter ON lineups.artists(promoter_id);
CREATE INDEX IF NOT EXISTS idx_artists_slug ON lineups.artists(promoter_id, slug);

-- M2M: artist na event (jeden event může mít více artistů — festival lineup)
CREATE TABLE IF NOT EXISTS lineups.event_artists (
  event_id      uuid NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  artist_id     uuid NOT NULL REFERENCES lineups.artists(id) ON DELETE CASCADE,
  order_index   integer NOT NULL DEFAULT 0,
  is_headliner  boolean NOT NULL DEFAULT false,
  set_starts_at timestamptz,
  set_duration_minutes integer,
  stage         text,
  added_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, artist_id)
);

CREATE INDEX IF NOT EXISTS idx_event_artists_artist
  ON lineups.event_artists(artist_id);

COMMENT ON TABLE lineups.event_artists IS
  'M2M event ↔ artist. Festival lineup, tour vystoupení. Order index pro display.';

COMMIT;
