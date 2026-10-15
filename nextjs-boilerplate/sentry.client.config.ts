// Soubor je no-op bez NEXT_PUBLIC_SENTRY_DSN env.
/**
 * Sentry client-side instrumentation.
 *
 * Spouští se v prohlížeči. Zachytává:
 *   - Unhandled exceptions
 *   - Unhandled promise rejections
 *   - React error boundaries (přes ErrorBoundary)
 *   - Performance metrics (Web Vitals)
 *
 * Aktivuje se jen pokud SENTRY_DSN je v env. Bez DSN = no-op (žádný overhead).
 */

import * as Sentry from '@sentry/nextjs';
import { SENTRY_DATA_COLLECTION, scrubSentryEvent, scrubSentrySpan } from './src/lib/observability/scrub-pii';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_ENV ?? process.env.NODE_ENV ?? 'production',
    release: process.env.NEXT_PUBLIC_APP_VERSION,

    // Sampling — 10 % session pro nedělat overhead, 100 % pro errory
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.0,
    replaysOnErrorSampleRate: 1.0,

    // Anti-PII: nesbírej IP, user-agent ano (pro debug)
    // Kolo 19: Sentry 11 — sendDefaultPii nahrazeno dataCollection (výchozí hodnoty v 11 sbírají víc)
    dataCollection: SENTRY_DATA_COLLECTION,

    // Filtrovat noise (chrome extension errors, network blip)
    ignoreErrors: [
      // Browser extensions
      /chrome-extension:\/\//,
      /moz-extension:\/\//,
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error promise rejection captured',
      // Network blip
      'NetworkError',
      'Failed to fetch',
      'Load failed',
      // Vendor SDK noise
      /^(https?:\/\/)?(?:www\.)?(google-analytics|googletagmanager|facebook\.net|connect\.facebook\.net)/,
    ],

    beforeSend(event, hint) {
      // V dev nepošli, jen log
      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console
        console.warn('[sentry dev]', event.exception?.values?.[0]?.value ?? hint.originalException);
        return null;
      }
      // Kolo 14 / krok 3: osobní údaje kupců (e-maily, jména, telefony) se do Sentry neposílají
      return scrubSentryEvent(event);
    },
    // Kolo 19: spany (span streaming v 11) beforeSend neprocházejí
    beforeSendSpan: (span) => scrubSentrySpan(span),
  });
}
