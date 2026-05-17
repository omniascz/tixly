// @ts-nocheck
// ^ Sentry config — TS check vynechán, dokud @sentry/nextjs není nainstalovaný
//   přes `npm install`. Soubor je no-op bez SENTRY_DSN env.
/**
 * Sentry edge runtime instrumentation.
 *
 * Middleware + edge functions (rate limit, auth check). Edge runtime má omezené API.
 */

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'production',
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  });
}
