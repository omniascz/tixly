// @ts-nocheck
// ^ Sentry config — TS check vynechán, dokud @sentry/nextjs není nainstalovaný
//   přes `npm install`. Soubor je no-op bez SENTRY_DSN env.
/**
 * Sentry server-side instrumentation (Node.js runtime).
 *
 * Zachytává:
 *   - Unhandled exceptions v API route handlerech
 *   - Database errors, fetch failures
 *   - Performance metrics serverových operací
 */

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'production',
    release: process.env.APP_VERSION,

    tracesSampleRate: 0.1,
    sendDefaultPii: false,

    ignoreErrors: [
      // PostgreSQL connection blip (Neon scale-to-zero wake)
      /connection terminated/i,
      /Connection terminated unexpectedly/i,
      // Validation errors — nemají být v Sentry, zod je validuje a vrací 422
      /ZodError/,
    ],

    beforeSend(event) {
      // Strip authorization header z requestů
      if (event.request?.headers) {
        const headers = event.request.headers as Record<string, string>;
        delete headers.authorization;
        delete headers.cookie;
        delete headers['x-internal-token'];
        delete headers['x-user-id'];
      }
      return event;
    },
  });
}
