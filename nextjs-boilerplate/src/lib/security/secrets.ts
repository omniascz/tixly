/**
 * resolveSecret — bezpečné vyhodnocení security-kritického secretu.
 *
 * Problém: getter typu `process.env.X ?? 'literal-z-repa'` znamená, že když X
 * v produkci chybí, podpisový klíč je VEŘEJNĚ ZNÁMÝ řetězec z gitu → kdokoli umí
 * forgnout token (vstupenku, magic link, print label, FB OAuth state…).
 *
 * Řešení (fail-closed): v produkci je chybějící secret fatální misconfigurace
 * (throw při startu/prvním použití), NIKDY se nesmí tiše použít literal.
 * V dev/test se deterministický fallback ponechá, aby lokální flow fungovaly.
 *
 * Pozn.: řetězení na `JWT_SECRET` (kompatibilita se stávajícím deploye) je OK —
 * jen samotný literal nesmí v produkci přežít. Ideál je dedikovaný env per secret
 * (separation of duties), ale to vyžaduje nastavení env PŘED deployem.
 */
export function resolveSecret(
  value: string | undefined | null,
  name: string,
  devFallback: string,
): string {
  if (value && value.length > 0) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `Security misconfiguration: ${name} must be set in production (refusing to use a hardcoded fallback secret).`,
    );
  }
  return devFallback;
}
