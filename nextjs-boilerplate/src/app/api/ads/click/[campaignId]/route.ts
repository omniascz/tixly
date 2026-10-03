/**
 * GET /api/ads/click/[campaignId]
 *
 * Public ad click tracker. Po zaznamenání + dekrementu budget redirectuje
 * uživatele na event detail page. Pokud kampaň neexistuje nebo je depleted,
 * fallback redirect na homepage.
 *
 * Dedup: stejné IP + campaign během 5 min = neplatí (vrácí redirect, ale
 * budget nedekrementuje).
 */

import { runWithServiceContext } from '@/lib/db/rls-pool';
import { NextRequest, NextResponse } from 'next/server';
import { trackAdClick } from '@/lib/ads/auction';

export async function GET(
  req: NextRequest,
  { params }: { params: { campaignId: string } },
): Promise<Response> {
  // Kolo 2 / 3B: veřejný klik na reklamu = systémový zápis (ad_auction_log/ad_clicks pod RLS)
  return runWithServiceContext(async () => {
  if (!/^[0-9a-f-]{36}$/i.test(params.campaignId)) {
    return NextResponse.redirect(new URL('/cs/events', req.url));
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const userAgent = req.headers.get('user-agent')?.slice(0, 500) ?? null;
  const userId = req.headers.get('x-user-id');

  const result = await trackAdClick({
    campaignId: params.campaignId,
    ip,
    userAgent,
    userId,
  }).catch((err) => {
    console.error('[ads click]', err);
    return null;
  });

  if (!result) {
    return NextResponse.redirect(new URL('/cs/events', req.url));
  }

  const target = result.eventSlug
    ? `/cs/events/${result.eventSlug}`
    : `/cs/events/${result.eventId}`;
  return NextResponse.redirect(new URL(target, req.url), 302);
  });
}
