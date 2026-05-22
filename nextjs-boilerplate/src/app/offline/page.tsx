'use client';

/**
 * Offline fallback page (PWA P2-5).
 *
 * Servisní worker přesměruje tu, když buyer nemá konektivitu a stránka
 * nebyla v cache. Sekce „Moje vstupenky" funguje offline (cached
 * `/cs/my-tickets` přes stale-while-revalidate v sw.js).
 */
export default function OfflinePage(): JSX.Element {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <div className="mb-4 text-5xl">📡</div>
      <h1 className="mb-2 text-2xl font-semibold">Jsi offline</h1>
      <p className="mb-6 max-w-md text-sm text-muted-foreground">
        Stránka, kterou se snažíš otevřít, není uložená v cache. Pokud máš
        zaplacené lístky, otevři{' '}
        <a href="/cs/my-tickets" className="underline">
          Moje vstupenky
        </a>{' '}
        — fungují i bez sítě.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-md border bg-card px-4 py-2 text-sm hover:bg-muted/50"
      >
        Zkusit znovu
      </button>
    </div>
  );
}
