/**
 * GET /r/[code]?event=<eventId> — public affiliate tracking redirect
 *
 * Skiddle Rep pattern (CZ priority #10, ROI 4/10). Affiliate (klub manager,
 * influencer) sdílí URL `tixly.cz/r/<code>?event=<id>`, kupec klikne →
 * redirect na event detail s ?ref=CODE v URL + cookie aff_code jako záloha.
 *
 * Checkout integration (`[locale]/checkout/page.tsx:172-179`) čte
 * `searchParams.get('ref')` a fallback `localStorage.getItem('tixly.ref')`.
 * Cross-session attribution drží přes localStorage (set na event detail page
 * po prvním kliku — TODO pokud chcem fancier attribution; pro MVP stačí
 * že kupec dorazí na checkout s ?ref= v URL).
 *
 * Cookie aff_code je 30-day backup pro server-side cases (qr-style flows,
 * embedded checkout). httpOnly=false aby ji JS mohl číst v UI.
 */
import { NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = 'aff_code';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 dnů

export async function GET(req: NextRequest, props: { params: Promise<{ code: string }> }): Promise<Response> {
  const params = await props.params;
  // Validate code format — letters/digits/underscore/dash, 2-40 chars
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(params.code)) {
    return NextResponse.redirect(new URL('/cs/events', req.url));
  }

  const code = params.code.toUpperCase();
  const eventId = req.nextUrl.searchParams.get('event');
  // Připoj ?ref=CODE do target URL aby checkout/page.tsx ho přečetl přes
  // searchParams.get('ref') (existing wired path).
  const basePath = eventId ? `/cs/events/${eventId}` : '/cs/events';
  const target = `${basePath}?ref=${encodeURIComponent(code)}`;

  const res = NextResponse.redirect(new URL(target, req.url));
  res.cookies.set(COOKIE_NAME, code, {
    maxAge: COOKIE_MAX_AGE,
    sameSite: 'lax',
    httpOnly: false,
    path: '/',
  });
  return res;
}
