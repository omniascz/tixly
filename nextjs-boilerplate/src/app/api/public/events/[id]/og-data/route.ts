/**
 * GET /api/public/events/[id]/og-data — minimální veřejná data pro OG image.
 *
 * Čte jen PUBLISHED akci (public-read policy). Slouží edge OG-image routě
 * (/api/og/events/[id]), která nemůže používat `pg` (edge runtime), takže si
 * data vytáhne tímhle fetchem. Public, no auth.
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: 'INVALID_ID' }, { status: 422 });
  }
  const r = await db().query<{
    title: string;
    date_start: string;
    venue_name: string | null;
    promoter_name: string | null;
    brand_color_hex: string | null;
  }>(
    `SELECT e.title, e.date_start::text,
            v.name AS venue_name, p.name AS promoter_name, p.brand_color_hex
       FROM catalog.events e
  LEFT JOIN catalog.venues v ON v.id = e.venue_id
  LEFT JOIN platform.promoters p ON p.id = e.promoter_id
      WHERE e.id = $1 AND e.status = 'published'`,
    [params.id],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  const e = r.rows[0];
  return NextResponse.json(
    {
      title: e.title,
      dateStart: e.date_start,
      venueName: e.venue_name,
      promoterName: e.promoter_name,
      brandColorHex: e.brand_color_hex,
    },
    { headers: { 'cache-control': 'public, max-age=3600' } },
  );
}
