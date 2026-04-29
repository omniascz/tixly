/**
 * WCAG 2.1 ARIA Utility Helpers
 */

export function generateAriaId(prefix: string): string {
  const randomId = Math.random().toString(36).slice(2, 9);
  return `${prefix}-${randomId}`;
}

export function combineAriaDescribedBy(
  ...ids: (string | undefined)[]
): string | undefined {
  const filtered = ids.filter((id): id is string => !!id && id.trim() !== '');
  return filtered.length > 0 ? filtered.join(' ') : undefined;
}

export function ariaLabel(text: string): { 'aria-label': string } {
  return { 'aria-label': text };
}

export function ariaDescribedBy(id: string): { 'aria-describedby': string } {
  return { 'aria-describedby': id };
}
