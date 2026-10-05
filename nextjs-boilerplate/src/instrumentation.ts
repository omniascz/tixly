/**
 * Next.js instrumentation hook.
 *
 * Spouští se jednou per worker při bootu. Načítá Sentry config podle runtime
 * (Node.js vs Edge runtime). Bez SENTRY_DSN je no-op.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Kolo 9: testovací prostředí (TIXLY_ENV=staging) nenastartuje, pokud ukazuje na produkční DB / ostré brány
    const { assertStagingIsolated } = await import('./lib/env/staging-guard');
    assertStagingIsolated();
    await import('../sentry.server.config');
  } else if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}
