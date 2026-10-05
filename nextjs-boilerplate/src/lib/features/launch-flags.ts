/**
 * Kolo 10 / krok 3 — přepínače nedokončených cest pro první ostrý provoz.
 *
 * Každá z těchto cest dnes umí vydat hodnotu bez skutečné platby nebo nemá dokončenou integraci:
 *   - splátky (plány splátek, cron charge-installments bez Stripe označí splátky jako zaplacené;
 *     BNPL Twisto / Skip Pay = jen simulátor),
 *   - předplatné (aktivace bez platby, abonentky přes mock platbu, cron renew-subscriptions prodlužuje bez platby,
 *     uplatnění předplatného v checkoutu = 100% sleva),
 *   - benefitní karty (chybí návratová URL po platbě; mimo Pluxee bez API).
 *
 * Výchozí stav: VYPNUTO. Zapíná se jen hodnotou `1`. Jedna proměnná na funkci — prefix NEXT_PUBLIC_, aby ji
 * četl server za běhu i UI (do klientského kódu se vkládá při buildu → změna v UI vyžaduje nový deploy).
 * Server kontroluje vždy (API, checkout, cron, callback) — skrytí v UI je jen pohodlí, ne ochrana.
 */
import { NextResponse } from 'next/server';

export type LaunchFeature = 'installments' | 'subscriptions' | 'benefitCards';

export function launchFeatureEnabled(feature: LaunchFeature): boolean {
  // Přímé odkazy (ne process.env[name]) — jen tak Next vloží hodnotu i do klientského kódu.
  switch (feature) {
    case 'installments': return process.env.NEXT_PUBLIC_FEATURE_INSTALLMENTS === '1';
    case 'subscriptions': return process.env.NEXT_PUBLIC_FEATURE_SUBSCRIPTIONS === '1';
    case 'benefitCards': return process.env.NEXT_PUBLIC_FEATURE_BENEFIT_CARDS === '1';
  }
}

/** Celá routa funkce: vypnuto → 404 (jako by neexistovala). */
export function launchFeatureNotFound(feature: LaunchFeature): NextResponse | null {
  return launchFeatureEnabled(feature) ? null : NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
}

/** Volba uvnitř jiné akce (checkout): vypnuto → 422 s kódem, objednávka se nezaloží. */
export function launchFeatureRejected(feature: LaunchFeature): NextResponse | null {
  return launchFeatureEnabled(feature)
    ? null
    : NextResponse.json({ error: 'FEATURE_DISABLED', feature }, { status: 422 });
}

/** Platební metody BNPL (splátky třetí strany) a benefitní karty v checkoutu. */
export const BNPL_METHODS: ReadonlySet<string> = new Set(['twisto', 'skippay']);
export const BENEFIT_METHODS: ReadonlySet<string> = new Set([
  'pluxee', 'sodexo', 'benefit_plus', 'edenred', 'gallery_beta', 'multisport',
]);
