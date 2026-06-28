-- Migration 389: GTM container ID + TikTok Events API credentials per promoter

ALTER TABLE platform.promoters ADD COLUMN IF NOT EXISTS gtm_container_id VARCHAR(20);

ALTER TABLE platform.promoters ADD COLUMN IF NOT EXISTS tiktok_pixel_id VARCHAR(50);

ALTER TABLE platform.promoters ADD COLUMN IF NOT EXISTS tiktok_events_token_enc TEXT;

COMMENT ON COLUMN platform.promoters.gtm_container_id IS 'Google Tag Manager container ID (GTM-XXXXXXX)';

COMMENT ON COLUMN platform.promoters.tiktok_pixel_id IS 'TikTok Pixel ID (public)';

COMMENT ON COLUMN platform.promoters.tiktok_events_token_enc IS 'TikTok Events API access token — encrypted';
