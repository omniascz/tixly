/**
 * ARIA Live Region Announcer — creates a live region and returns announce/destroy helpers
 */

export function createAnnouncer(): {
  announce(message: string, politeness?: 'polite' | 'assertive'): void;
  destroy(): void;
} {
  let politeEl: HTMLElement | null = null;
  let assertiveEl: HTMLElement | null = null;

  function getOrCreateRegion(politeness: 'polite' | 'assertive'): HTMLElement {
    if (politeness === 'assertive') {
      if (!assertiveEl) {
        assertiveEl = document.createElement('div');
        assertiveEl.setAttribute('aria-live', 'assertive');
        assertiveEl.setAttribute('aria-atomic', 'true');
        assertiveEl.setAttribute('role', 'alert');
        Object.assign(assertiveEl.style, {
          position: 'absolute',
          width: '1px',
          height: '1px',
          padding: '0',
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
          whiteSpace: 'nowrap',
          border: '0',
        });
        document.body.appendChild(assertiveEl);
      }
      return assertiveEl;
    }

    if (!politeEl) {
      politeEl = document.createElement('div');
      politeEl.setAttribute('aria-live', 'polite');
      politeEl.setAttribute('aria-atomic', 'true');
      Object.assign(politeEl.style, {
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: '0',
        overflow: 'hidden',
        clip: 'rect(0,0,0,0)',
        whiteSpace: 'nowrap',
        border: '0',
      });
      document.body.appendChild(politeEl);
    }
    return politeEl;
  }

  function announce(message: string, politeness: 'polite' | 'assertive' = 'polite'): void {
    // Only works in browser environment
    if (typeof document === 'undefined') return;
    const el = getOrCreateRegion(politeness);
    // Clear and re-set to trigger screen reader announcement
    el.textContent = '';
    // Use setTimeout to ensure the DOM mutation is picked up
    setTimeout(() => {
      el.textContent = message;
    }, 50);
  }

  function destroy(): void {
    if (politeEl) {
      politeEl.remove();
      politeEl = null;
    }
    if (assertiveEl) {
      assertiveEl.remove();
      assertiveEl = null;
    }
  }

  return { announce, destroy };
}
