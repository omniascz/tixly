-- Migration 435: 360° / 3D seat view support
-- Extends catalog.seat_view_photos (created in mig 413) with embed URL and 360 flag.

ALTER TABLE catalog.seat_view_photos ADD COLUMN IF NOT EXISTS view_type text NOT NULL DEFAULT 'photo';
ALTER TABLE catalog.seat_view_photos ADD COLUMN IF NOT EXISTS embed_url text;
ALTER TABLE catalog.seat_view_photos ADD COLUMN IF NOT EXISTS is_360 boolean NOT NULL DEFAULT false;
