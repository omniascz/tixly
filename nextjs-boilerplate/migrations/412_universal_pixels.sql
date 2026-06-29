-- Migration 412: Universal Pixel Manager — 27+ tracking pixel types
-- Extends marketing.tracking_pixels to support all major advertising/analytics platforms

-- Drop old platform CHECK constraint (only had 7 types)
DO $$ BEGIN
  ALTER TABLE marketing.tracking_pixels
    DROP CONSTRAINT IF EXISTS tracking_pixels_platform_check;
EXCEPTION WHEN others THEN NULL;
END $$;

-- Add new constraint covering 30 pixel types
ALTER TABLE marketing.tracking_pixels
  ADD CONSTRAINT tracking_pixels_platform_check
  CHECK (platform IN (
    -- Advertising
    'meta', 'google_ads', 'google_analytics', 'gtm',
    'tiktok', 'snapchat', 'twitter', 'pinterest', 'linkedin',
    'microsoft_bing', 'criteo', 'rtb_house', 'adform',
    'outbrain', 'taboola', 'reddit', 'quora',
    -- Analytics / CRO
    'hotjar', 'microsoft_clarity', 'smartlook', 'yandex_metrica', 'vwo',
    -- Marketing automation
    'klaviyo', 'hubspot', 'activecampaign',
    -- Product analytics
    'segment', 'mixpanel', 'amplitude',
    -- Custom
    'custom_script', 'custom_image'
  ));

-- Friendly label for the pixel (e.g. "Pražský Maratón – Meta")
ALTER TABLE marketing.tracking_pixels
  ADD COLUMN IF NOT EXISTS pixel_name TEXT;

-- Server-side conversion token (encrypted) — for platforms with CAPI
ALTER TABLE marketing.tracking_pixels
  ADD COLUMN IF NOT EXISTS capi_token_enc TEXT;

-- Extended platform-specific config (conversion labels, write keys, etc.)
ALTER TABLE marketing.tracking_pixels
  ADD COLUMN IF NOT EXISTS extra_config JSONB DEFAULT '{}';

-- Index for fast lookup by platform
CREATE INDEX IF NOT EXISTS idx_tracking_pixels_platform
  ON marketing.tracking_pixels (platform);
