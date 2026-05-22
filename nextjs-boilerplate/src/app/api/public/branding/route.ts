/**
 * GET /api/public/branding — vrátí white-label branding podle hosta
 *
 * Query param `host` (?host=narodni-divadlo.cz) NEBO Host header.
 * Pokud doména matchuje verified promoter_domains row → vrátí branding;
 * jinak `{ whitelabel: false }` (Tixly default).
 *
 * Client volá v root layoutu pro CSS variable injection. Cache 60s
 * server-side (resolveWhiteLabel) + 5min v HTTP response.
 *
 * DACH parity #P1-4 (Ticketino TaaS pattern).
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveWhiteLabel } from '@/lib/white-label/domain';

export async function GET(req: NextRequest): Promise<Response> {
  const hostQuery = req.nextUrl.searchParams.get('host');
  const host =
    hostQuery ?? req.headers.get('host') ?? req.headers.get('x-forwarded-host');
  if (!host) {
    return NextResponse.json({ whitelabel: false, reason: 'NO_HOST' });
  }

  const ctx = await resolveWhiteLabel(host);
  if (!ctx) {
    return NextResponse.json(
      { whitelabel: false, host },
      { headers: { 'Cache-Control': 'public, max-age=300' } },
    );
  }

  return NextResponse.json(
    {
      whitelabel: true,
      host,
      promoterId: ctx.promoterId,
      promoterSlug: ctx.promoterSlug,
      promoterName: ctx.promoterName,
      logoUrl: ctx.brandingLogoUrl,
      primaryColor: ctx.brandingPrimaryColor,
      hidePoweredBy: ctx.brandingHidePoweredBy,
    },
    { headers: { 'Cache-Control': 'public, max-age=300' } },
  );
}
