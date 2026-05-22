-- 317_seat_view_photos.sql
-- DACH parity #P2-6: Saalplan Click&View foto preview (Reservix exclusive).
-- Promotér nahraje fotku pohledu ze konkrétního sedadla, buyer při výběru
-- vidí náhled "co uvidíš z A12". Reservix to dělá přes mobile app fotí
-- in-place; my v MVP přijímáme URL paste (Blob/CDN upload externí).
--
-- Per event_seat (NE venue master) — pro MVP. V budoucnu lze cross-event
-- propagovat přes (venue_id, section, row, seat_number) match.
--
-- Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS catalog.event_seat_view_photos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_seat_id       uuid NOT NULL UNIQUE REFERENCES catalog.event_seats(id) ON DELETE CASCADE,
  photo_url           text NOT NULL,
  thumbnail_url       text,
  caption             text,
  captured_at         timestamptz NOT NULL DEFAULT now(),
  captured_by_user_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_seat_view_photos_seat
  ON catalog.event_seat_view_photos(event_seat_id);

-- RLS — promotér scope přes JOIN event_seats → events → promoter_id
ALTER TABLE catalog.event_seat_view_photos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'catalog' AND tablename = 'event_seat_view_photos'
      AND policyname = 'p_seat_photos_tenant'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY p_seat_photos_tenant ON catalog.event_seat_view_photos
        FOR ALL
        USING (
          app_is_platform_admin()
          OR EXISTS (
            SELECT 1 FROM catalog.event_seats es
            JOIN catalog.events e ON e.id = es.event_id
            WHERE es.id = event_seat_view_photos.event_seat_id
              AND e.promoter_id = app_current_promoter_id()
          )
        )
    $POL$;
  END IF;
END $$;

COMMENT ON TABLE catalog.event_seat_view_photos IS
  'Click&View: pohled ze sedadla foto (Reservix pattern). Buyer hover = preview.';
COMMENT ON COLUMN catalog.event_seat_view_photos.photo_url IS
  'Public URL (Vercel Blob nebo CDN). Mock režim přijímá URL paste.';
COMMENT ON COLUMN catalog.event_seat_view_photos.thumbnail_url IS
  'Lazy-loaded thumbnail pro seat picker hover (optional, fallback na photo_url).';

COMMIT;
