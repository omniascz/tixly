// Type-safe postMessage wrapper pro komunikaci widget iframe ↔ hostující stránka.
// Posílá zprávy jen na důvěryhodný origin (TIXLY_ORIGIN).

import type { WidgetMessage } from '../types/widget.types';

export const TIXLY_ORIGIN = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tixly.cz';

/**
 * Odešle zprávu z iframe na nadřazenou stránku.
 * Volat pouze uvnitř widget page (ne v embed scriptu).
 */
/**
 * Ověří, zda je origin na whitelistu (přesná shoda nebo wildcard `https://*.example.com`).
 * Používá se pro validaci příchozích postMessage zpráv host page → widget
 * a také pro CSP `frame-ancestors` hlavičku na straně serveru.
 */
export function isAllowedOrigin(origin: string, whitelist: string[]): boolean {
  if (!origin || whitelist.length === 0) return false;
  for (const allowed of whitelist) {
    if (allowed === '*') return true;
    if (allowed === origin) return true;
    // Wildcard subdomain: https://*.example.com
    const m = allowed.match(/^(https?):\/\/\*\.(.+)$/);
    if (m) {
      const proto = m[1];
      const base = m[2];
      const re = new RegExp(`^${proto}:\\/\\/([a-z0-9-]+\\.)+${base.replace(/\./g, '\\.')}$`, 'i');
      if (re.test(origin)) return true;
    }
  }
  return false;
}

export function sendToParent(message: WidgetMessage): void {
  if (typeof window === 'undefined' || window.parent === window) return;
  window.parent.postMessage(message, TIXLY_ORIGIN);
}

/**
 * Přijímá zprávy na hostující stránce a ověřuje origin.
 * Vrací cleanup funkci (removeEventListener).
 */
export function onWidgetMessage(
  handler: (message: WidgetMessage) => void,
  trustedOrigin: string = TIXLY_ORIGIN,
): () => void {
  const listener = (event: MessageEvent) => {
    if (event.origin !== trustedOrigin) return;
    const msg = event.data as WidgetMessage;
    if (typeof msg !== 'object' || !msg.type?.startsWith('TIXLY_')) return;
    handler(msg);
  };

  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
