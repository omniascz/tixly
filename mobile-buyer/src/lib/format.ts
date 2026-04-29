/**
 * Formats a price in hellers (integer) to a human-readable CZK string.
 * 9900 haléřů → "99 Kč"
 * 150000 haléřů → "1 500 Kč"
 */
export function formatPrice(hellers: number): string {
  const czk = Math.floor(hellers / 100);
  // Format with regular space as thousands separator (U+0020)
  // Using manual formatting to guarantee a regular space regardless of platform locale
  const formatted = czk
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '\u0020');
  return `${formatted} Kč`;
}

/**
 * Formats an ISO date string to a human-readable Czech date/time string.
 * Converts to Europe/Prague timezone.
 * '2026-05-10T17:00:00.000Z' → '10. 5. 2026 19:00'
 */
export function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Prague',
    hour12: false,
  };
  const parts = new Intl.DateTimeFormat('cs-CZ', options).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';

  const day = get('day');
  const month = get('month');
  const year = get('year');
  const hour = get('hour');
  const minute = get('minute');

  return `${day}. ${month}. ${year} ${hour}:${minute}`;
}
