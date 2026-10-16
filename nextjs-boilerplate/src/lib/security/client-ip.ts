import type { NextRequest } from 'next/server';

/**
 * Důvěryhodná klientská IP pro rate-limit / audit.
 *
 * Problém: `x-forwarded-for`.split(',')[0] (levý prvek) je KLIENTEM ovladatelný —
 * platforma reálnou IP do XFF APPENDuje, takže útočník může levý prvek prependnout
 * a rotovat tím rate-limit klíč (obejít brute-force ochranu loginu apod.).
 *
 * Na Vercelu je `req.ip` plněné edge platformou z reálného TCP spojení a NEJDE
 * podvrhnout hlavičkou → bereme ho přednostně. Bez něj (lokál / jiná infra)
 * padáme na `x-real-ip` a jako poslední možnost na PRAVÝ konec XFF (poslední hop
 * přidaný nejbližším důvěryhodným proxy), ne levý.
 *
 * Kolo 15: Next 15 `req.ip` už neplní; na Vercelu se tak bere `x-real-ip`, kterou nastavuje platforma — totéž čte
 * oficiální náhrada `ipAddress()` z @vercel/functions (IP_HEADER_NAME = 'x-real-ip'), výsledná IP je stejná.
 */
export function clientIp(req: NextRequest): string {
  const vercelIp = (req as NextRequest & { ip?: string }).ip;
  if (vercelIp) return vercelIp;

  const realIp = req.headers.get('x-real-ip');
  if (realIp && realIp.trim()) return realIp.trim();

  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return 'unknown';
}
