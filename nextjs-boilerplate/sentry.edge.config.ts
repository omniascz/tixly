// @ts-nocheck
// ^ Sentry config — TS check vynechán, dokud @sentry/nextjs není nainstalovaný
//   přes `npm install`. Soubor je no-op bez SENTRY_DSN env.
/**
 * Sentry edge runtime instrumentation.
 *
 * Middleware + edge functions (rate limit, auth check). Edge runtime má omezené API.
 */

import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent } from './src/lib/observability/scrub-pii';

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'production',
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    // Kolo 14 / krok 3: osobní údaje kupců (e-maily, jména, telefony) se do Sentry neposílají
    beforeSend: (event) => scrubSentryEvent(event),
  });
}
