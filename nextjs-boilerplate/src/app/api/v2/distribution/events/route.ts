import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { verifyDistributionToken } from '@/lib/distribution/auth';

export async function GET(req: NextRequest): Promise<Response> {
  // Kolo 2 / 3B: partner ověřen tokenem (lib/distribution/auth); distribution_* pod RLS jen svc/admin
  return runWithServiceContext(async () => {
  const ctx = await verifyDistributionToken(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10));
  const perPage = Math.min(100, Math.max(1, parseInt(sp.get('per_page') ?? '50', 10)));
  const offset = (page - 1) * perPage;
  const country = sp.get('country') ?? null;
  const city = sp.get('city') ?? null;
  const category = sp.get('category') ?? null;
  const from = sp.get('from') ?? null;
  const to = sp.get('to') ?? null;

  const conditions: string[] = [`e.status = 'published'`];
  const params: unknown[] = [];

  if (country) { params.push(country); conditions.push(`v.country = $${params.length}`); }
  if (city) { params.push(city); conditions.push(`v.city = $${params.length}`); }
  if (category) { params.push(category); conditions.push(`e.category = $${params.length}`); }
  if (from) { params.push(from); conditions.push(`e.date_start >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`e.date_start <= $${params.length}`); }

  const where = conditions.join(' AND ');

  const countRes = await db().query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM catalog.events e
     LEFT JOIN catalog.venues v ON v.id = e.venue_id
     WHERE ${where}`,
    params,
  );
  const total = parseInt(countRes.rows[0]?.total ?? '0', 10);

  params.push(perPage, offset);
  const rows = await db().query<{
    id: string;
    title: string;
    date_start: string;
    date_end: string | null;
    venue_name: string | null;
    city: string | null;
    country: string | null;
    category: string | null;
    min_price_halire: string | null;
    max_price_halire: string | null;
    currency: string;
    remaining_capacity: string | null;
    total_capacity: string | null;
    status: string;
    cover_image_url: string | null;
    slug: string | null;
    promoter_slug: string | null;
  }>(
    `SELECT
       e.id, e.title, e.date_start, e.date_end,
       v.name AS venue_name, v.city, v.country,
       e.category,
       (SELECT MIN(tt.base_price) FROM catalog.ticket_types tt
          WHERE tt.event_id = e.id AND tt.visibility = 'public')::text AS min_price_halire,
       (SELECT MAX(tt.base_price) FROM catalog.ticket_types tt
          WHERE tt.event_id = e.id AND tt.visibility = 'public')::text AS max_price_halire,
       COALESCE(e.currency, 'CZK') AS currency,
       (SELECT SUM(tt.remaining_qty) FROM catalog.ticket_types tt
          WHERE tt.event_id = e.id AND tt.visibility = 'public')::text AS remaining_capacity,
       (SELECT SUM(tt.total_qty) FROM catalog.ticket_types tt
          WHERE tt.event_id = e.id)::text AS total_capacity,
       e.status,
       e.cover_image_url,
       e.slug,
       p.slug AS promoter_slug
     FROM catalog.events e
     LEFT JOIN catalog.venues v ON v.id = e.venue_id
     LEFT JOIN platform.promoters p ON p.id = e.promoter_id
     WHERE ${where}
     ORDER BY e.date_start ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const events = rows.rows.map((r) => ({
    id: r.id,
    title: r.title,
    date_start: r.date_start,
    date_end: r.date_end,
    venue_name: r.venue_name,
    city: r.city,
    country: r.country,
    category: r.category,
    min_price_halire: r.min_price_halire ? parseInt(r.min_price_halire, 10) : null,
    max_price_halire: r.max_price_halire ? parseInt(r.max_price_halire, 10) : null,
    currency: r.currency,
    available_tickets: r.remaining_capacity ? parseInt(r.remaining_capacity, 10) : 0,
    total_capacity: r.total_capacity ? parseInt(r.total_capacity, 10) : 0,
    status: r.status,
    image_url: r.cover_image_url,
    checkout_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/e/${r.slug ?? r.id}`,
  }));

  return NextResponse.json({ events, total, page, per_page: perPage });
  });
}
