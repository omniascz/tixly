/**
 * Formátuje cenu v haléřích pro zobrazení ve widgetu.
 * Stejná logika jako formatVoucherValue v gift-vouchers modulu.
 */
export function formatWidgetPrice(halere: number, currency: string, locale: string): string {
  const divisor = currency === 'JPY' ? 1 : 100;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: currency === 'JPY' ? 0 : undefined,
  }).format(halere / divisor);
}
