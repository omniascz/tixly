-- Migration 375: per-promoter marketing tracking (Meta Pixel + CAPI, GA4)
--
-- Pixel/measurement IDs jsou veřejné (jdou do prohlížeče) → plaintext.
-- CAPI access token a GA4 api_secret jsou TAJNÉ → ukládáme šifrovaně
-- (AES-256-GCM přes src/lib/crypto encryptSecret), sloupce mají suffix _enc.
--
-- Předtím byl tracking per-event (catalog.events.meta_pixel_id atd.) — nebyl
-- ale nikde nastavitelný. Přesouváme ho na promotéra: jeden pixel pro celé
-- divadlo, sdílený přes všechny jeho akce.

BEGIN;

ALTER TABLE platform.promoters
  ADD COLUMN IF NOT EXISTS meta_pixel_id       TEXT,
  ADD COLUMN IF NOT EXISTS meta_capi_token_enc TEXT,
  ADD COLUMN IF NOT EXISTS ga4_measurement_id  TEXT,
  ADD COLUMN IF NOT EXISTS ga4_api_secret_enc  TEXT;

COMMENT ON COLUMN platform.promoters.meta_pixel_id IS 'Meta Pixel ID (veřejné, jde do prohlížeče)';
COMMENT ON COLUMN platform.promoters.meta_capi_token_enc IS 'Meta Conversions API access token, šifrovaný (AES-256-GCM)';
COMMENT ON COLUMN platform.promoters.ga4_measurement_id IS 'GA4 Measurement ID G-XXXX (veřejné)';
COMMENT ON COLUMN platform.promoters.ga4_api_secret_enc IS 'GA4 Measurement Protocol api_secret, šifrovaný (AES-256-GCM)';

COMMIT;
