/**
 * HTML entity escape — pro template stringy v e-mailových šablonách.
 *
 * E-mail klienti většinou nepouštějí skripty, ale `<img onerror="...">` nebo
 * malformed tag mohou rozbít layout. Escape všeho, co pochází z user-input
 * (event title, buyer name, venue name, ticket type name, …).
 *
 * Použití:
 *   `<h1>${escapeHtml(order.title)}</h1>`
 */
export function escapeHtml(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
