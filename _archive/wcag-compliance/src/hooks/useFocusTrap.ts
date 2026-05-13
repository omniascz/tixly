/**
 * Focus Trap — pure TypeScript, no React dependency (for testability)
 */

export interface FocusTrapOptions {
  onEscape?: () => void;
}

const FOCUSABLE_SELECTORS = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS));
}

export function createFocusTrap(
  container: HTMLElement,
  options?: FocusTrapOptions
): { activate(): void; deactivate(): void } {
  let handleKeyDown: ((e: KeyboardEvent) => void) | null = null;

  function activate(): void {
    handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        options?.onEscape?.();
        return;
      }

      if (e.key !== 'Tab') return;

      const focusable = getFocusableElements(container);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement;

      if (e.shiftKey) {
        if (active === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);

    // Move focus inside the trap if not already there
    const focusable = getFocusableElements(container);
    if (focusable.length > 0 && !container.contains(document.activeElement)) {
      focusable[0].focus();
    }
  }

  function deactivate(): void {
    if (handleKeyDown) {
      container.removeEventListener('keydown', handleKeyDown);
      handleKeyDown = null;
    }
  }

  return { activate, deactivate };
}
