/**
 * WhiteLabelTheme — server component
 *
 * Resolve white-label podle Host headeru a injectuje CSS custom property
 * pro primary color. Pokud `hidePoweredBy=true`, schová Tixly badge.
 *
 * Použito v root layout. Žádné fetchování klienta — všechno server-side.
 *
 * DACH parity #P1-4 (Ticketino TaaS pattern).
 */
import { headers } from 'next/headers';
import { resolveWhiteLabel } from '@/lib/white-label/domain';

export async function WhiteLabelTheme(): Promise<JSX.Element | null> {
  const h = headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (!host) return null;
  const ctx = await resolveWhiteLabel(host).catch(() => null);
  if (!ctx || !ctx.brandingPrimaryColor) return null;

  // CSS custom property override
  return (
    <style id="whitelabel-theme" data-testid="whitelabel-theme">
      {`:root { --primary: ${ctx.brandingPrimaryColor}; --tw-primary: ${ctx.brandingPrimaryColor}; }`}
    </style>
  );
}

/**
 * Server component badge — "Powered by Tixly".
 * Skryje se pokud promotér zaplatil tier s hide_powered_by=true.
 */
export async function PoweredByTixly(): Promise<JSX.Element | null> {
  const h = headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (!host) {
    return (
      <a
        href="https://tixly.cz"
        className="text-xs text-muted-foreground hover:underline"
        data-testid="powered-by-tixly"
      >
        Powered by Tixly
      </a>
    );
  }
  const ctx = await resolveWhiteLabel(host).catch(() => null);
  if (ctx?.brandingHidePoweredBy) return null;
  return (
    <a
      href="https://tixly.cz"
      className="text-xs text-muted-foreground hover:underline"
      data-testid="powered-by-tixly"
    >
      Powered by Tixly
    </a>
  );
}
