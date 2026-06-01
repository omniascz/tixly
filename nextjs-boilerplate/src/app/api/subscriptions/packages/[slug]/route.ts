/**
 * GET /api/subscriptions/packages/[slug]
 *
 * Public — detail abonentky včetně list pokrytých představení.
 *
 * Path: /api/subscriptions/packages/pondelni-2026-27?promoter=divadlo-v-celetne
 *
 * Query param `promoter` (slug) je povinný (slug abonentky není globálně unique).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';


export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const promoterSlug = req.nextUrl.searchParams.get('promoter');
  if (!promoterSlug || !/^[a-z0-9-]{2,80}$/.test(promoterSlug)) {
    return NextResponse.json({ error: 'PROMOTER_SLUG_REQUIRED' }, { status: 400 });
  }
  if (!/^[a-z0-9-]{2,80}$/.test(slug)) {
    return NextResponse.json({ error: 'INVALID_SLUG' }, { status: 400 });
  }

  const pkg = await db().query<{
    id: string;
    name: string;
    description: string | null;
    season_label: string;
    category: string;
    base_price_halire: number;
    early_bird_until: string | null;
    early_bird_price_halire: number | null;
    currency: string;
    sale_start: string;
    sale_end: string | null;
    capacity: number | null;
    holders_count: string;
    status: string;
    promoter_name: string;
    brand_color_hex: string | null;
    venue_name: string | null;
  }>(
    `SELECT pkg.id, pkg.name, pkg.description, pkg.season_label, pkg.category,
            pkg.base_price_halire,
            pkg.early_bird_until::text, pkg.early_bird_price_halire,
            pkg.currency,
            pkg.sale_start::text, pkg.sale_end::text,
            pkg.capacity, pkg.status,
            (SELECT COUNT(*)::text FROM subscriptions.holders
               WHERE package_id = pkg.id AND status = 'active') AS holders_count,
            p.name AS promoter_name, p.brand_color_hex,
            v.name AS venue_name
       FROM subscriptions.packages pkg
       JOIN platform.promoters p ON p.id = pkg.promoter_id
       LEFT JOIN catalog.venues v ON v.id = pkg.venue_id
      WHERE pkg.slug = $1 AND p.slug = $2 AND pkg.status IN ('on_sale', 'sold_out')`,
    [slug, promoterSlug],
  );
  if (pkg.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  const p = pkg.rows[0];

  const events = await db().query<{
    id: string;
    title: string;
    slug: string | null;
    date_start: string;
    venue_name: string | null;
  }>(
    `SELECT e.id, e.title, e.slug, e.date_start::text,
            v.name AS venue_name
       FROM subscriptions.package_events pe
       JOIN catalog.events e ON e.id = pe.event_id
       LEFT JOIN catalog.venues v ON v.id = e.venue_id
      WHERE pe.package_id = $1 AND e.status = 'published'
      ORDER BY pe.order_index ASC, e.date_start ASC`,
    [p.id],
  );

  const now = new Date();
  const earlyBirdActive =
    p.early_bird_until !== null &&
    p.early_bird_price_halire !== null &&
    new Date(p.early_bird_until) > now;
  const effectivePriceHalire = earlyBirdActive
    ? p.early_bird_price_halire!
    : p.base_price_halire;

  return NextResponse.json({
    package: {
      id: p.id,
      name: p.name,
      description: p.description,
      seasonLabel: p.season_label,
      category: p.category,
      basePriceHalire: p.base_price_halire,
      effectivePriceHalire,
      earlyBirdActive,
      earlyBirdUntil: p.early_bird_until,
      currency: p.currency,
      capacity: p.capacity,
      holdersCount: Number(p.holders_count),
      saleStart: p.sale_start,
      saleEnd: p.sale_end,
      status: p.status,
      promoterName: p.promoter_name,
      brandColorHex: p.brand_color_hex,
      venueName: p.venue_name,
    },
    events: events.rows.map((e) => ({
      id: e.id,
      title: e.title,
      slug: e.slug,
      dateStart: e.date_start,
      venueName: e.venue_name,
    })),
  });
}
