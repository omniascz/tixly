/**
 * GET /api/public/events
 *
 * Unified public discovery endpoint — partner-ready, no auth required.
 *
 * Query params:
 *   category    - event category slug (concert, theatre, festival, sport, ...)
 *   city        - city name (case-insensitive partial match)
 *   promoter_id - filter by promoter UUID
 *   date_from   - ISO date (YYYY-MM-DD)
 *   date_to     - ISO date
 *   min_price   - min ticket price in CZK
 *   max_price   - max ticket price in CZK
 *   q           - keyword search in title / description
 *   sort        - date_asc | date_desc | price_asc | price_desc | relevance (default: date_asc)
 *   limit       - max 100, default 20
 *   offset      - pagination offset, default 0
 *
 * Response: { events[], total, limit, offset, _links }
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

const SORT_MAP: Record<string, string> = {
  date_asc:   'e.starts_at ASC',
  date_desc:  'e.starts_at DESC',
  price_asc:  'min_price ASC NULLS LAST',
  price_desc: 'min_price DESC NULLS LAST',
  relevance:  'e.starts_at ASC',
};

interface EventRow {
  id: string;
  title: string;
  slug: string | null;
  description: string | null;
  category: string | null;
  starts_at: string;
  ends_at: string | null;
  venue_name: string | null;
  venue_city: string | null;
  cover_image_url: string | null;
  min_price: number | null;
  max_price: number | null;
  currency: string;
  promoter_id: string;
  promoter_name: string | null;
  available_capacity: number | null;
  total: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {
    const sp = req.nextUrl.searchParams;

    const limit  = Math.min(100, Math.max(1, Number(sp.get('limit')  ?? 20)));
    const offset = Math.max(0, Number(sp.get('offset') ?? 0));
    const sort   = SORT_MAP[sp.get('sort') ?? 'date_asc'] ?? SORT_MAP.date_asc;

    const category   = sp.get('category')?.trim()    ?? null;
    const city       = sp.get('city')?.trim()         ?? null;
    const promoterId = sp.get('promoter_id')?.trim()  ?? null;
    const dateFrom   = sp.get('date_from')?.trim()    ?? null;
    const dateTo     = sp.get('date_to')?.trim()      ?? null;
    const minPrice   = sp.get('min_price') ? Number(sp.get('min_price')) * 100 : null;
    const maxPrice   = sp.get('max_price') ? Number(sp.get('max_price')) * 100 : null;
    const q          = sp.get('q')?.trim()            ?? null;

    const conditions: string[] = [
      `e.status = 'published'`,
      `e.starts_at >= NOW()`,
    ];
    const vals: unknown[] = [];

    if (category) {
      vals.push(category.toLowerCase());
      conditions.push(`LOWER(e.category) = $${vals.length}`);
    }
    if (city) {
      vals.push(`%${city.toLowerCase()}%`);
      conditions.push(`LOWER(v.city) LIKE $${vals.length}`);
    }
    if (promoterId && /^[0-9a-f-]{36}$/i.test(promoterId)) {
      vals.push(promoterId);
      conditions.push(`e.promoter_id = $${vals.length}`);
    }
    if (dateFrom) {
      vals.push(dateFrom);
      conditions.push(`e.starts_at >= $${vals.length}::date`);
    }
    if (dateTo) {
      vals.push(dateTo);
      conditions.push(`e.starts_at < ($${vals.length}::date + INTERVAL '1 day')`);
    }
    if (minPrice !== null) {
      vals.push(minPrice);
      conditions.push(`min_price >= $${vals.length}`);
    }
    if (maxPrice !== null) {
      vals.push(maxPrice);
      conditions.push(`(min_price IS NULL OR min_price <= $${vals.length})`);
    }
    if (q) {
      vals.push(`%${q.toLowerCase()}%`);
      conditions.push(`(LOWER(e.title) LIKE $${vals.length} OR LOWER(e.description) LIKE $${vals.length})`);
    }

    const where = conditions.join(' AND ');

    const baseQuery = `
      FROM catalog.events e
      LEFT JOIN catalog.venues v ON v.id = e.venue_id
      LEFT JOIN platform.promoters p ON p.id = e.promoter_id
      LEFT JOIN LATERAL (
        SELECT MIN(base_price_halire) AS min_price, MAX(base_price_halire) AS max_price
        FROM catalog.ticket_types
        WHERE event_id = e.id AND status = 'published'
      ) tt ON true
      WHERE ${where}
    `;

    vals.push(limit, offset);
    const dataQ = `
      SELECT
        e.id, e.title, e.slug, LEFT(e.description, 300) AS description,
        e.category, e.starts_at, e.ends_at,
        v.name AS venue_name, v.city AS venue_city,
        e.cover_image_url,
        tt.min_price, tt.max_price,
        e.currency,
        e.promoter_id, p.name AS promoter_name,
        e.available_capacity,
        COUNT(*) OVER() AS total
      ${baseQuery}
      ORDER BY ${sort}
      LIMIT $${vals.length - 1} OFFSET $${vals.length}
    `;

    const r = await db().query<EventRow>(dataQ, vals);
    const total = Number(r.rows[0]?.total ?? 0);

    const events = r.rows.map((ev) => ({
      id:          ev.id,
      title:       ev.title,
      slug:        ev.slug,
      description: ev.description,
      category:    ev.category,
      startsAt:    ev.starts_at,
      endsAt:      ev.ends_at,
      venue: {
        name: ev.venue_name,
        city: ev.venue_city,
      },
      coverImageUrl: ev.cover_image_url,
      price: {
        min:      ev.min_price != null ? ev.min_price / 100 : null,
        max:      ev.max_price != null ? ev.max_price / 100 : null,
        currency: ev.currency ?? 'CZK',
      },
      promoter: {
        id:   ev.promoter_id,
        name: ev.promoter_name,
      },
      availableCapacity: ev.available_capacity,
      ticketUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/cs/p/${ev.slug ?? ev.id}`,
    }));

    const baseUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/public/events`;
    const qStr = req.nextUrl.search;

    const makeLink = (o: number) => {
      const u = new URL(baseUrl);
      req.nextUrl.searchParams.forEach((v, k) => { if (k !== 'offset') u.searchParams.set(k, v); });
      u.searchParams.set('offset', String(o));
      return u.toString();
    };

    return NextResponse.json({
      events,
      total,
      limit,
      offset,
      _links: {
        self: `${baseUrl}${qStr}`,
        ...(offset + limit < total ? { next: makeLink(offset + limit) } : {}),
        ...(offset > 0            ? { prev: makeLink(Math.max(0, offset - limit)) } : {}),
      },
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        'Access-Control-Allow-Origin': '*',
      },
    });
  });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
