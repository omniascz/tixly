/**
 * GET /api/v1/wl/events
 *
 * Returns events available through this white-label tenant.
 * Filtered by allowed_promoter_ids (empty = all promoters).
 *
 * Auth: Bearer wl_live_* or wl_test_*
 *
 * Query params:
 *   ?dateFrom=ISO8601  (default: now)
 *   ?dateTo=ISO8601    (default: now + 90 days)
 *   ?promoterId=uuid   (filter to specific promoter)
 *   ?limit=50          (max 200)
 *   ?cursor=eventId    (pagination)
 *
 * Response:
 * {
 *   events: [{
 *     id, slug, title, description, imageUrl,
 *     venue: { name, city, address },
 *     dateStart, dateEnd,
 *     ticketTypes: [{ id, name, price, currency, available }],
 *     checkoutUrl
 *   }],
 *   nextCursor
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { verifyWlToken, wlResponseHeaders } from '@/lib/whitelabel/tenant-auth';

export const dynamic = 'force-dynamic';

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: wlResponseHeaders() });
}

interface EventRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  poster_url: string | null;
  date_start: string;
  date_end: string | null;
  venue_name: string | null;
  venue_city: string | null;
  venue_address: string | null;
  promoter_id: string;
  ticket_types: Array<{
    id: string;
    name: string;
    price_halire: number;
    currency: string;
    capacity_remaining: number;
  }> | null;
}

export async function GET(req: NextRequest): Promise<Response> {
  const tenant = await verifyWlToken(req);
  if (!tenant) {
    return NextResponse.json(
      { error: 'UNAUTHORIZED' },
      { status: 401, headers: wlResponseHeaders() },
    );
  }

  const url = new URL(req.url);
  const dateFrom = url.searchParams.get('dateFrom') ?? new Date().toISOString();
  const dateTo   = url.searchParams.get('dateTo')   ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const promoterId = url.searchParams.get('promoterId');
  const limit    = Math.min(Number(url.searchParams.get('limit') ?? '50'), 200);
  const cursor   = url.searchParams.get('cursor');

  // Build promoter filter
  const allowedPromoters = tenant.allowedPromoterIds;
  const promoterFilter = allowedPromoters.length > 0
    ? `AND e.promoter_id = ANY($5::uuid[])`
    : '';
  const specificPromoterFilter = promoterId ? `AND e.promoter_id = $6::uuid` : '';

  return runWithServiceContext(async () => {
    const params: unknown[] = [dateFrom, dateTo, limit + 1, cursor ?? null];
    if (allowedPromoters.length > 0) params.push(allowedPromoters);
    if (promoterId) params.push(promoterId);

    const res = await db().query<EventRow>(
      `SELECT
         e.id, e.slug, e.date_start, e.date_end, e.promoter_id,
         pr.title, pr.description, pr.poster_url,
         v.name AS venue_name, v.city AS venue_city, v.address AS venue_address,
         (
           SELECT json_agg(json_build_object(
             'id', tt.id,
             'name', tt.name,
             'price_halire', tt.base_price,
             'currency', e.currency,
             'capacity_remaining', tt.remaining_qty
           ) ORDER BY tt.base_price ASC)
           FROM catalog.ticket_types tt
           WHERE tt.event_id = e.id AND tt.remaining_qty > 0
         ) AS ticket_types
       FROM catalog.events e
       JOIN catalog.productions pr ON pr.id = e.production_id
       LEFT JOIN catalog.venues v ON v.id = e.venue_id
       WHERE e.status = 'published'
         AND e.date_start >= $1
         AND e.date_start <= $2
         AND ($4::uuid IS NULL OR e.id > $4)
         ${promoterFilter}
         ${specificPromoterFilter}
       ORDER BY e.date_start ASC, e.id ASC
       LIMIT $3`,
      params,
    );

    const rows = res.rows;
    const hasMore = rows.length > limit;
    const events = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? events[events.length - 1]?.id : null;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
    const embedParam = `?brand=${tenant.slug}`;

    return NextResponse.json(
      {
        events: events.map((e) => ({
          id:          e.id,
          slug:        e.slug,
          title:       e.title,
          description: e.description,
          imageUrl:    e.poster_url,
          venue: {
            name:    e.venue_name,
            city:    e.venue_city,
            address: e.venue_address,
          },
          dateStart:    e.date_start,
          dateEnd:      e.date_end,
          ticketTypes:  (e.ticket_types ?? []).map((tt) => ({
            id:        tt.id,
            name:      tt.name,
            price:     tt.price_halire,
            currency:  tt.currency,
            available: tt.capacity_remaining,
          })),
          checkoutUrl: `${appUrl}/events/${e.slug}/checkout${embedParam}`,
        })),
        nextCursor,
      },
      { headers: wlResponseHeaders(tenant) },
    );
  });
}
