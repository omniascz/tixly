import type { StandardEventName } from '../types/tracking.js';

/**
 * Mapa interních event názvů na Meta (Facebook) Pixel standardní events.
 * Pokud mapping chybí, posíláme event jako 'trackCustom'.
 */
export const META_EVENT_MAP: Record<string, string> = {
  page_view: 'PageView',
  view_item: 'ViewContent',
  add_to_cart: 'AddToCart',
  begin_checkout: 'InitiateCheckout',
  purchase: 'Purchase',
  sign_up: 'CompleteRegistration',
  login: 'Login',
  lead: 'Lead',
  reservation_created: 'Schedule',
  reservation_cancelled: 'CancelReservation',
  package_purchased: 'Purchase',
};

/**
 * Vrátí, zda je dané jméno Meta standardní (volá se fbq('track', ...))
 * nebo custom (volá se fbq('trackCustom', ...)).
 */
const META_STANDARD_EVENTS = new Set([
  'PageView',
  'ViewContent',
  'AddToCart',
  'InitiateCheckout',
  'Purchase',
  'CompleteRegistration',
  'Lead',
  'Schedule',
  'Search',
  'AddPaymentInfo',
  'AddToWishlist',
  'Contact',
  'CustomizeProduct',
  'Donate',
  'FindLocation',
  'StartTrial',
  'SubmitApplication',
  'Subscribe',
]);

export function mapToMetaEvent(name: StandardEventName | string): {
  metaName: string;
  isStandard: boolean;
} {
  const mapped = META_EVENT_MAP[name];
  if (mapped && META_STANDARD_EVENTS.has(mapped)) {
    return { metaName: mapped, isStandard: true };
  }
  if (mapped) {
    return { metaName: mapped, isStandard: false };
  }
  return { metaName: name, isStandard: false };
}
