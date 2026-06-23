/**
 * Browser-side Meta Pixel helper. Bezpečně zavolá window.fbq, pokud je pixel
 * inicializovaný (přes <MetaPixel/>). Když pixel není (promotér nemá ID,
 * adblock, SSR), tiše nic neudělá.
 *
 * eventId = dedup klíč proti server-side CAPI události se stejným event_id
 * (Meta spáruje pixel + CAPI a nepočítá konverzi 2×).
 */

type Fbq = (...args: unknown[]) => void;

export function fbqTrack(
  event: string,
  data?: Record<string, unknown>,
  eventId?: string,
): void {
  if (typeof window === 'undefined') return;
  const fbq = (window as unknown as { fbq?: Fbq }).fbq;
  if (typeof fbq !== 'function') return;
  if (eventId) fbq('track', event, data ?? {}, { eventID: eventId });
  else fbq('track', event, data ?? {});
}
