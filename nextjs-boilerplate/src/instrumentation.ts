/**
 * Next.js instrumentation hook.
 *
 * Spouští se jednou per worker při bootu. Načítá Sentry config podle runtime
 * (Node.js vs Edge runtime). Bez SENTRY_DSN je no-op.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  } else if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}
