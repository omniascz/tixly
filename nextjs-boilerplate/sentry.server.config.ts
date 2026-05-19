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

      // Runbook URL injection — každý alert má odkaz na příslušnou sekci
      // docs/RUNBOOK-DISASTER-RECOVERY.md. Mapování podle url path nebo tagů.
      event.tags = event.tags ?? {};
      const runbookBase =
        'https://github.com/omnia/tixly/blob/main/docs/RUNBOOK-DISASTER-RECOVERY.md';
      const url = event.request?.url ?? '';
      if (url.includes('/api/health/db') || url.includes('catalog.events')) {
        event.tags.runbook = `${runbookBase}#41-postgres-výpadek-p0`;
      } else if (url.includes('/api/health/redis') || url.includes('seat-hold')) {
        event.tags.runbook = `${runbookBase}#42-redis-výpadek-p1`;
      } else if (url.includes('/api/payments') || url.includes('/api/webhooks/gopay')) {
        event.tags.runbook = `${runbookBase}#44-payment-provider-výpadek-p0`;
      } else if (url.includes('/api/email') || url.includes('bullmq')) {
        event.tags.runbook = `${runbookBase}#43-email-queue-výpadek-p1`;
      } else {
        event.tags.runbook = runbookBase;
      }

      return event;
    },
  });
}
