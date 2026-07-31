-- 435_seat_view_3d
-- Rozšíření seat_view_photos o 360° embed URL.
-- is_360 = true → photo_url/embed_url se zobrazí v iframe (Matterport, Google Photos 360, YouTube VR …)
-- embed_url je volitelná alternativa k photo_url pro vlastní embed endpoint.

ALTER TABLE catalog.seat_view_photos ADD COLUMN is_360 boolean NOT NULL DEFAULT false;
ALTER TABLE catalog.seat_view_photos ADD COLUMN embed_url text;
