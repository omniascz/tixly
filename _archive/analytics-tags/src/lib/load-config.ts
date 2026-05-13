import type { TrackingConfig } from '../types/tracking.js';

/**
 * Načti tracking konfiguraci z NEXT_PUBLIC_* env proměnných.
 * Volat lze jak na serveru, tak na klientu (NEXT_PUBLIC_* prefixed).
 */
export function loadTrackingConfig(): TrackingConfig {
  return {
    ga4MeasurementId: process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID || null,
    metaPixelId: process.env.NEXT_PUBLIC_META_PIXEL_ID || null,
    gtmContainerId: process.env.NEXT_PUBLIC_GTM_CONTAINER_ID || null,
    requireConsent: process.env.NEXT_PUBLIC_REQUIRE_CONSENT !== 'false',
    debug: process.env.NEXT_PUBLIC_TRACKING_DEBUG === 'true',
  };
}
