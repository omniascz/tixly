// Soubor je no-op bez SENTRY_DSN env.
/**
 * Sentry edge runtime instrumentation.
 *
 * Middleware + edge functions (rate limit, auth check). Edge runtime má omezené API.
 */

import * as Sentry from '@sentry/nextjs';
import { SENTRY_DATA_COLLECTION, scrubSentryEvent, scrubSentrySpan } from './src/lib/observability/scrub-pii';

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'production',
    tracesSampleRate: 0.1,
    // Kolo 19: Sentry 11 — sendDefaultPii nahrazeno dataCollection (výchozí hodnoty v 11 sbírají víc)
    dataCollection: SENTRY_DATA_COLLECTION,
    // Kolo 14 / krok 3: osobní údaje kupců (e-maily, jména, telefony) se do Sentry neposílají
    beforeSend: (event) => scrubSentryEvent(event),
    // Kolo 19: spany (span streaming v 11) beforeSend neprocházejí
    beforeSendSpan: (span) => scrubSentrySpan(span),
  });
}
