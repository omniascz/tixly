/**
 * CSRF ochrana stavových požadavků autentizovaných cookie (FIX K5, kolo 3).
 *
 * Do kola 3 stála jen na SameSite=Lax cookie. Nově middleware u POST/PUT/PATCH/DELETE,
 * které nesou auth cookie, vyžaduje Origin (případně Referer) vlastního webu; cizí nebo
 * chybějící → 403. Modul je čistý (bez Node API) — používá ho middleware.
 *
 * Výjimky (nejsou cookie-autentizované prohlížečem, mají vlastní ověření):
 *   - platební webhooky a callbacky (server→server, podpis / dotaz na bránu),
 *   - cron a interní routy (CRON_SECRET / INTERNAL_SERVICE_TOKEN),
 *   - OAuth callbacky (Apple posílá form_post z appleid.apple.com, ověřuje se id_token),
 *   - Bearer API: platný `Authorization: Bearer` — tuto hlavičku cizí stránka bez CORS poslat neumí.
 */
import type { NextRequest } from 'next/server';

export const AUTH_COOKIES = ['accessToken', 'refreshToken', 'session_jwt', 'buyer_jwt'] as const;

const EXEMPT: RegExp[] = [
  /^\/api\/payments\/[^/]+\/webhook\/?$/,
  /^\/api\/payments\/benefit\//,
  /^\/api\/qes\/webhook\/?$/,
  /^\/api\/cron\//,
  /^\/api\/internal\//,
  /^\/api\/auth\/oauth\/callback\//,
];

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isStateChangingMethod(method: string): boolean {
  return STATE_CHANGING.has(method.toUpperCase());
}

export function isCsrfExemptPath(pathname: string): boolean {
  return EXEMPT.some((re) => re.test(pathname));
}

export function hasAuthCookie(req: NextRequest): boolean {
  return AUTH_COOKIES.some((n) => !!req.cookies.get(n)?.value);
}

function originOf(url: string | null | undefined): string | null {
  if (!url || url === 'null') return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Origin vlastního webu: host požadavku (vč. white-label domén) + nakonfigurované APP_URL. */
function allowedOrigins(req: NextRequest): Set<string> {
  const out = new Set<string>([req.nextUrl.origin]);
  for (const u of [process.env.APP_URL, process.env.NEXT_PUBLIC_APP_URL]) {
    const o = originOf(u);
    if (o) out.add(o);
  }
  return out;
}

/** true = požadavek prokazatelně pochází z vlastního webu (Origin, jinak Referer). */
export function isSameOriginRequest(req: NextRequest): boolean {
  const allowed = allowedOrigins(req);
  const origin = req.headers.get('origin');
  if (origin !== null) {
    const o = originOf(origin);
    return o !== null && allowed.has(o);
  }
  const ref = originOf(req.headers.get('referer'));
  return ref !== null && allowed.has(ref);
}
