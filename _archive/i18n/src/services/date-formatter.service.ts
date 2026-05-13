import type { Locale } from '../lib/types.js';

function toDate(date: Date | string): Date {
  if (date instanceof Date) return date;
  return new Date(date);
}

/**
 * Zero-pads a number to the given width.
 */
function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/**
 * Formats a date according to locale conventions.
 * cs/sk: '15. 3. 2025'
 * en:    '03/15/2025'
 * de:    '15.03.2025'
 */
export function formatDate(date: Date | string, locale: Locale): string {
  const d = toDate(date);
  const day = d.getDate();
  const month = d.getMonth() + 1;
  const year = d.getFullYear();

  switch (locale) {
    case 'cs':
    case 'sk':
      return `${day}. ${month}. ${year}`;
    case 'en':
      return `${pad(month)}/${pad(day)}/${year}`;
    case 'de':
      return `${pad(day)}.${pad(month)}.${year}`;
    default:
      return `${day}. ${month}. ${year}`;
  }
}

/**
 * Formats a date + time according to locale conventions.
 * cs/sk: '15. 3. 2025 18:30'
 * en:    '03/15/2025 6:30 PM'
 * de:    '15.03.2025 18:30'
 */
export function formatDateTime(date: Date | string, locale: Locale): string {
  const d = toDate(date);
  const datePart = formatDate(d, locale);
  const hours = d.getHours();
  const minutes = d.getMinutes();

  if (locale === 'en') {
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours % 12 || 12;
    return `${datePart} ${h12}:${pad(minutes)} ${ampm}`;
  }

  return `${datePart} ${pad(hours)}:${pad(minutes)}`;
}

/**
 * Formats only the time portion according to locale conventions.
 * cs/sk/de: '18:30'
 * en:       '6:30 PM'
 */
export function formatTime(date: Date | string, locale: Locale): string {
  const d = toDate(date);
  const hours = d.getHours();
  const minutes = d.getMinutes();

  if (locale === 'en') {
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours % 12 || 12;
    return `${h12}:${pad(minutes)} ${ampm}`;
  }

  return `${pad(hours)}:${pad(minutes)}`;
}
