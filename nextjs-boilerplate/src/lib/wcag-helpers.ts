// Server-side WCAG helpers pro API responses a form validation
// Generuje accessible error messages s ARIA pointers

export interface AccessibleError {
  field: string;
  message: string;
  ariaDescribedBy: string; // ID error elementu
}

export function toAccessibleErrors(
  errors: Record<string, string>
): AccessibleError[] {
  return Object.entries(errors).map(([field, message]) => ({
    field,
    message,
    ariaDescribedBy: `error-${field}`,
  }));
}

export function skipLinkHref(targetId: string): string {
  return `#${targetId}`;
}
