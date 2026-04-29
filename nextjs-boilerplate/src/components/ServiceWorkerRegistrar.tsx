'use client';

import { useEffect } from 'react';

/**
 * Registruje service worker pro PWA + offline ticket cache.
 * Pouze v produkci a v browseru s SW podporou.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    // Only register on https or localhost
    if (
      window.location.hostname !== 'localhost' &&
      window.location.protocol !== 'https:'
    ) {
      return;
    }
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('[sw] register failed', err);
    });
  }, []);
  return null;
}
