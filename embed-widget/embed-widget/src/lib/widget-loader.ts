/**
 * Tixly Embed Widget Loader
 *
 * Promotér vloží na svůj web:
 *
 *   <div data-tixly-event="evt_abc123"
 *        data-tixly-locale="cs"
 *        data-tixly-color="#e63946">
 *   </div>
 *   <script src="https://tixly.cz/embed.js" async></script>
 *
 * Skript najde všechny kontejnery, vloží do nich iframe a automaticky
 * přizpůsobuje výšku obsahu (bez scrollbaru).
 *
 * Bezpečnost:
 *   - Platební flow běží na tixly.cz (ne na webu promotéra).
 *   - iframe má sandbox omezení (allow-scripts, allow-forms, allow-popups).
 *   - postMessage origin je ověřen na obou stranách.
 */

const TIXLY_BASE_URL = 'https://tixly.cz';
const CONTAINER_ATTR = 'data-tixly-event';

interface WidgetInstance {
  eventId: string;
  iframe: HTMLIFrameElement;
  container: HTMLElement;
  cleanup: () => void;
}

const instances: Map<HTMLElement, WidgetInstance> = new Map();

// ---------------------------------------------------------------------------
// initWidget
// ---------------------------------------------------------------------------

function initWidget(container: HTMLElement): void {
  if (instances.has(container)) return;   // již inicializováno

  const eventId = container.getAttribute(CONTAINER_ATTR);
  if (!eventId) return;

  const locale = container.getAttribute('data-tixly-locale') ?? 'cs';
  const color = container.getAttribute('data-tixly-color') ?? '';

  // Sestavíme URL widgetu
  const params = new URLSearchParams({ locale });
  if (color) params.set('color', color);
  const src = `${TIXLY_BASE_URL}/widget/${encodeURIComponent(eventId)}?${params}`;

  // iframe
  const iframe = document.createElement('iframe');
  iframe.src = src;
  iframe.setAttribute(
    'sandbox',
    'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin',
  );
  iframe.setAttribute('allow', 'payment');
  iframe.loading = 'lazy';
  iframe.style.cssText = [
    'width:100%',
    'border:none',
    'display:block',
    'min-height:300px',
    'transition:height 0.2s ease',
  ].join(';');
  iframe.title = 'Tixly — prodej vstupenek';

  // Kontejner
  container.style.overflow = 'hidden';
  container.innerHTML = '';
  container.appendChild(iframe);

  // postMessage: auto-resize
  function onMessage(event: MessageEvent): void {
    if (event.origin !== TIXLY_BASE_URL) return;
    if (!event.data || typeof event.data !== 'object') return;
    if (event.source !== iframe.contentWindow) return;

    const msg = event.data as { type: string; height?: number };

    if (msg.type === 'TIXLY_RESIZE' && typeof msg.height === 'number') {
      iframe.style.height = `${msg.height}px`;
    }

    if (msg.type === 'TIXLY_CHECKOUT_STARTED') {
      // Checkout se otevře v novém tabu (platba na tixly.cz)
    }
  }

  window.addEventListener('message', onMessage);

  // ResizeObserver — pokud se změní šířka kontejneru, informuj iframe
  let resizeTimeout: ReturnType<typeof setTimeout>;
  const resizeObserver = new ResizeObserver(() => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      iframe.contentWindow?.postMessage({ type: 'TIXLY_CONTAINER_WIDTH', width: container.offsetWidth }, TIXLY_BASE_URL);
    }, 100);
  });
  resizeObserver.observe(container);

  instances.set(container, {
    eventId,
    iframe,
    container,
    cleanup: () => {
      window.removeEventListener('message', onMessage);
      resizeObserver.disconnect();
      clearTimeout(resizeTimeout);
    },
  });
}

// ---------------------------------------------------------------------------
// destroyWidget
// ---------------------------------------------------------------------------

export function destroyWidget(container: HTMLElement): void {
  const instance = instances.get(container);
  if (!instance) return;
  instance.cleanup();
  container.innerHTML = '';
  instances.delete(container);
}

// ---------------------------------------------------------------------------
// initAll — najde a inicializuje všechny kontejnery na stránce
// ---------------------------------------------------------------------------

export function initAll(): void {
  const containers = document.querySelectorAll<HTMLElement>(`[${CONTAINER_ATTR}]`);
  containers.forEach(initWidget);
}

// ---------------------------------------------------------------------------
// Auto-init při načtení skriptu (IIFE)
// ---------------------------------------------------------------------------

function bootstrap(): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }

  // MutationObserver — zachytí kontejnery přidané po načtení stránky (SPA)
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.hasAttribute(CONTAINER_ATTR)) initWidget(node);
        node.querySelectorAll<HTMLElement>(`[${CONTAINER_ATTR}]`).forEach(initWidget);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

bootstrap();
