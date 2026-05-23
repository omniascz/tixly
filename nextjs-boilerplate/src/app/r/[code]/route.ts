/**
 * GET /r/[code]?event=<eventId> — public affiliate tracking redirect
 *
 * Skiddle Rep pattern (CZ priority #10, ROI 4/10). Affiliate (klub manager,
 * influencer) sdílí URL `tixly.cz/r/<code>?event=<id>`, kupec klikne,
 * cookie aff_code se nastaví, redirect na event detail. Checkout přečte
 * cookie / přijme aff body field a linkne order na affiliate.
 *
 * Cookie aff_code je 30-day, sameSite=lax aby přežil cross-domain (sdílení
 * z FB / Insta link). Domain wide — všechny eventy v session counted.
 */
import { NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = 'aff_code';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 dnů

export async function GET(
  req: NextRequest,
  { params }: { params: { code: string } },
): Promise<Response> {
  // Validate code format — letters/digits/underscore/dash, 2-40 chars
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(params.code)) {
    return NextResponse.redirect(new URL('/cs/events', req.url));
  }

  const eventId = req.nextUrl.searchParams.get('event');
  const target = eventId
    ? `/cs/events/${eventId}`
    : '/cs/events';

  const res = NextResponse.redirect(new URL(target, req.url));
  res.cookies.set(COOKIE_NAME, params.code.toUpperCase(), {
    maxAge: COOKIE_MAX_AGE,
    sameSite: 'lax',
    httpOnly: false, // čteme z client (checkout form) i serveru
    path: '/',
  });
  return res;
}
