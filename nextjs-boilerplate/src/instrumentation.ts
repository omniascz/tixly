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
    try {
      assertStagingIsolated();
    } catch (err) {
      // Kolo 10: proces skončí — jinak by Next jen hlásil chybu u každého požadavku a server dál naslouchal.
      console.error((err as Error).message);
      process.exit(1);
    }
    await import('../sentry.server.config');
  } else if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}
