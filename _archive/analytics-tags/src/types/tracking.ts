export interface TrackingConfig {
  /** Google Analytics 4 measurement ID, e.g. "G-XXXXXXXXXX" */
  ga4MeasurementId: string | null;
  /** Meta (Facebook) Pixel ID */
  metaPixelId: string | null;
  /** Google Tag Manager container ID */
  gtmContainerId: string | null;
  /** Cookie consent gate — only fire if user consented to "analytics" or "marketing" */
  requireConsent: boolean;
  /** Debug mode — log events to console */
  debug: boolean;
}

export type StandardEventName =
  | 'page_view'
  | 'view_item'           // event detail page
  | 'add_to_cart'
  | 'begin_checkout'
  | 'purchase'
  | 'sign_up'
  | 'login'
  | 'lead'                // lead form submission
  | 'reservation_created'
  | 'reservation_cancelled'
  | 'package_purchased';

export interface EventItem {
  id: string;
  name: string;
  category?: string;
  price?: number;
  quantity?: number;
}

export interface EventPayload {
  /** Monetary value in major units (Kč) */
  value?: number;
  /** Currency code, e.g. 'CZK' */
  currency?: string;
  items?: EventItem[];
  /** Custom dimensions */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Global augmentation — gtag & fbq
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}
