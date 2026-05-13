import type { EventPayload, StandardEventName } from '../types/tracking.js';
import { mapToMetaEvent } from './event-mapping.js';
import { loadTrackingConfig } from './load-config.js';

/**
 * Client-side helper pro tracking custom events.
 * Auto-routuje na GA4 (gtag) + Meta Pixel (fbq).
 *
 * SSR-safe: na serveru (bez `window`) je no-op.
 */
export function trackEvent(
  name: StandardEventName | string,
  payload?: EventPayload,
): void {
  if (typeof window === 'undefined') return;

  const config = loadTrackingConfig();

  if (config.debug) {
    // eslint-disable-next-line no-console
    console.log('[analytics-tags] trackEvent', name, payload ?? {});
  }

  // GA4 / GTM dataLayer
  if (typeof window.gtag === 'function') {
    try {
      window.gtag('event', name, payload ?? {});
    } catch (err) {
      if (config.debug) {
        // eslint-disable-next-line no-console
        console.warn('[analytics-tags] gtag error', err);
      }
    }
  }

  // Meta Pixel
  if (typeof window.fbq === 'function') {
    const { metaName, isStandard } = mapToMetaEvent(name);
    const method = isStandard ? 'track' : 'trackCustom';
    // Meta Pixel očekává value + currency na top-levelu
    const metaPayload: Record<string, unknown> = { ...(payload ?? {}) };
    if (payload?.items) {
      metaPayload.contents = payload.items.map((i) => ({
        id: i.id,
        quantity: i.quantity ?? 1,
        item_price: i.price,
      }));
      metaPayload.content_type = 'product';
    }
    try {
      window.fbq(method, metaName, metaPayload);
    } catch (err) {
      if (config.debug) {
        // eslint-disable-next-line no-console
        console.warn('[analytics-tags] fbq error', err);
      }
    }
  }
}
