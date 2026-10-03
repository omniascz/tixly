/**
 * Pošle požadavek SKUTEČNÝM `src/middleware.ts` a teprve to, co middleware propustí,
 * předá route handleru — stejně jako Next.js runtime.
 *
 * Proč: route handlery věří `x-user-id` (a dalším hlavičkám), protože je má nastavovat
 * výhradně middleware z ověřeného JWT. Test, který handler volá napřímo s ručně
 * nastaveným `x-user-id`, tím obchází právě tu vrstvu, o kterou jde, a podvržení
 * identity nemůže zachytit.
 *
 * Next.js předává přepsané hlavičky požadavku přes response hlavičky
 * `x-middleware-override-headers` (seznam klíčů) + `x-middleware-request-<klíč>`;
 * klíč, který v seznamu není, runtime z požadavku odstraní. Totéž dělá tenhle helper.
 */
import { NextRequest } from 'next/server';

export interface MiddlewareOutcome {
  /** Odpověď middlewaru, pokud požadavek NEPROPUSTIL (401/403/redirect), jinak null. */
  blocked: Response | null;
  /** Hlavičky, se kterými by požadavek dorazil do handleru (null, pokud blocked). */
  forwardedHeaders: Headers | null;
}

export async function runMiddleware(req: Request): Promise<MiddlewareOutcome> {
  const { middleware } = await import('@/middleware');
  const res = await middleware(new NextRequest(req.clone()));
  if (res.headers.get('x-middleware-next') !== '1') return { blocked: res, forwardedHeaders: null };
  const override = res.headers.get('x-middleware-override-headers');
  let fwd: Headers;
  if (override === null) {
    fwd = new Headers(req.headers);
  } else {
    fwd = new Headers();
    for (const k of override.split(',').map((s) => s.trim()).filter(Boolean)) {
      const v = res.headers.get(`x-middleware-request-${k}`);
      if (v !== null) fwd.set(k, v);
    }
  }
  return { blocked: null, forwardedHeaders: fwd };
}

/** Middleware → (pokud propustí) handler. Vrací odpověď, kterou by dostal klient. */
export async function throughMiddleware<C>(
  req: Request,
  handler: (r: NextRequest, ctx: C) => Promise<Response>,
  ctx?: C,
): Promise<Response> {
  const { blocked, forwardedHeaders } = await runMiddleware(req);
  if (blocked) return blocked;
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.clone().text();
  const next = new NextRequest(req.url, { method: req.method, headers: forwardedHeaders!, body });
  return handler(next, ctx as C);
}
