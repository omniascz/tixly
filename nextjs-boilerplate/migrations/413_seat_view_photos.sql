-- 413_seat_view_photos
-- Venue-level fotky z pohledu z každého sektoru sálu.
-- Jedna fotka per (venue, sector_name) — sdílí se přes všechny eventy v daném sálu.

CREATE TABLE IF NOT EXISTS catalog.seat_view_photos (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      uuid        NOT NULL REFERENCES catalog.venues(id) ON DELETE CASCADE,
  sector_name   text        NOT NULL,
  photo_url     text        NOT NULL,
  thumbnail_url text,
  caption       text,
  sort_order    int         NOT NULL DEFAULT 0,
  created_by    uuid        REFERENCES identity.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id, sector_name)
);

CREATE INDEX IF NOT EXISTS idx_seat_view_photos_venue
  ON catalog.seat_view_photos (venue_id);

-- RLS: čtení veřejné (buyer picker), zápis jen platform admin
ALTER TABLE catalog.seat_view_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY svp_select_all ON catalog.seat_view_photos
  FOR SELECT USING (true);

CREATE POLICY svp_insert_admin ON catalog.seat_view_photos
  FOR INSERT WITH CHECK (
    current_setting('app.is_platform_admin', true) = 'true'
  );

CREATE POLICY svp_update_admin ON catalog.seat_view_photos
  FOR UPDATE USING (
    current_setting('app.is_platform_admin', true) = 'true'
  );

CREATE POLICY svp_delete_admin ON catalog.seat_view_photos
  FOR DELETE USING (
    current_setting('app.is_platform_admin', true) = 'true'
  );
