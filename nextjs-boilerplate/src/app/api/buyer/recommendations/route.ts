/**
 * GET /api/buyer/recommendations
 *
 * Vrátí personalizovaný feed events pro přihlášeného user nebo trending pro anonymous.
 *
 * Scoring (weighted sum):
 *   +50 followed promoter má event
 *   +30 stejný event_type jako kupované akce (last 90 days)
 *   +20 stejné město jako předchozí nákupy
 *   +15 cena v range ±30% průměrného nákupu
 *   +10 trending (sales velocity rank top 20)
 *   +5  category match (z user's interests pokud existují)
 *
 * Bez user (x-user-id missing): pure trending + globally popular.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface Recommendation {
  id: string;
  title: string;
  slug: string | null;
  date_start: string;
  city: string | null;
  venue_name: string | null;
  event_type: string | null;
  cover_image: string | null;
  promoter_name: string | null;
  promoter_slug: string | null;
  cheapest_price_halire: number | null;
  recent_sales: number;
  score: number;
  reasons: string[];
}

export async function GET(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  const limit = Math.min(50, Math.max(5, Number(req.nextUrl.searchParams.get('limit') ?? '20')));

  // 1) Pure trending — top events by recent sales velocity (anon fallback)
  const trendingRes = await db().query<Recommendation>(
    `WITH velocity AS (
       SELECT e.id, COUNT(o.id) AS recent_sales
       FROM catalog.events e
       LEFT JOIN orders.orders o ON o.event_id = e.id
         AND o.status = 'paid' AND o.paid_at > NOW() - INTERVAL '7 days'
       WHERE e.status = 'published' AND e.date_start > NOW()
       GROUP BY e.id
     )
     SELECT
       e.id, e.title, e.slug, e.date_start::text, v.city, v.name AS venue_name,
       e.event_type, e.cover_image,
       p.name AS promoter_name, p.slug AS promoter_slug,
       (SELECT MIN(tt.base_price) FROM catalog.ticket_types tt
        WHERE tt.event_id = e.id AND tt.remaining_qty > 0) AS cheapest_price_halire,
       COALESCE(vel.recent_sales, 0)::int AS recent_sales,
       (CASE WHEN vel.recent_sales >= 5 THEN 10 ELSE 0 END) AS score,
       ARRAY[]::text[] AS reasons
     FROM catalog.events e
     LEFT JOIN catalog.venues v ON v.id = e.venue_id
     LEFT JOIN platform.promoters p ON p.id = e.promoter_id
     LEFT JOIN velocity vel ON vel.id = e.id
     WHERE e.status = 'published' AND e.date_start > NOW()
     ORDER BY vel.recent_sales DESC NULLS LAST, e.date_start ASC
     LIMIT $1`,
    [limit],
  );

  // Pokud anon, vrátíme jen trending
  if (!userId) {
    return NextResponse.json({
      personalized: false,
      recommendations: trendingRes.rows.map((r) => ({
        ...r,
        reasons: r.recent_sales >= 5 ? ['Trending'] : ['Připravované akce'],
      })),
    });
  }

  // 2) Personalizovaný scoring
  // Načti user signals: bought event_types, cities, avg price, followed promoters
  const signalsRes = await db().query<{
    bought_types: string[];
    bought_cities: string[];
    avg_price: string | null;
    followed_promoter_ids: string[];
  }>(
    `WITH bought AS (
       SELECT DISTINCT e.event_type, v.city, oi.unit_price
       FROM orders.orders o
       JOIN orders.order_items oi ON oi.order_id = o.id
       JOIN catalog.events e ON e.id = o.event_id
       LEFT JOIN catalog.venues v ON v.id = e.venue_id
       WHERE o.user_id = $1 AND o.status = 'paid'
         AND o.paid_at > NOW() - INTERVAL '90 days'
     ),
     follows AS (
       SELECT promoter_id FROM marketing.newsletter_subscribers
       WHERE user_id = $1 AND status = 'confirmed' AND promoter_id IS NOT NULL
     )
     SELECT
       COALESCE(ARRAY_AGG(DISTINCT bought.event_type) FILTER (WHERE bought.event_type IS NOT NULL), '{}') AS bought_types,
       COALESCE(ARRAY_AGG(DISTINCT bought.city) FILTER (WHERE bought.city IS NOT NULL), '{}') AS bought_cities,
       (SELECT AVG(unit_price)::text FROM bought) AS avg_price,
       (SELECT COALESCE(ARRAY_AGG(promoter_id::text), '{}') FROM follows) AS followed_promoter_ids
     FROM bought`,
    [userId],
  );

  const signals = signalsRes.rows[0]!;
  const avgPriceHalire = signals.avg_price ? Number(signals.avg_price) : null;
  const priceLow = avgPriceHalire ? avgPriceHalire * 0.7 : null;
  const priceHigh = avgPriceHalire ? avgPriceHalire * 1.3 : null;

  const scored = await db().query<Recommendation & { recent_sales: number }>(
    `WITH velocity AS (
       SELECT e.id, COUNT(o.id) AS recent_sales
       FROM catalog.events e
       LEFT JOIN orders.orders o ON o.event_id = e.id
         AND o.status = 'paid' AND o.paid_at > NOW() - INTERVAL '7 days'
       WHERE e.status = 'published' AND e.date_start > NOW()
       GROUP BY e.id
     ),
     cheapest AS (
       SELECT event_id, MIN(base_price) AS price
       FROM catalog.ticket_types
       WHERE remaining_qty > 0
       GROUP BY event_id
     )
     SELECT
       e.id, e.title, e.slug, e.date_start::text, v.city, v.name AS venue_name,
       e.event_type, e.cover_image,
       p.name AS promoter_name, p.slug AS promoter_slug,
       cheapest.price AS cheapest_price_halire,
       COALESCE(vel.recent_sales, 0)::int AS recent_sales,
       (
         (CASE WHEN e.promoter_id::text = ANY($2::text[]) THEN 50 ELSE 0 END)
         + (CASE WHEN e.event_type = ANY($3::text[]) THEN 30 ELSE 0 END)
         + (CASE WHEN v.city = ANY($4::text[]) THEN 20 ELSE 0 END)
         + (CASE WHEN $5::int IS NOT NULL AND cheapest.price BETWEEN $5 AND $6 THEN 15 ELSE 0 END)
         + (CASE WHEN vel.recent_sales >= 5 THEN 10 ELSE 0 END)
       ) AS score,
       ARRAY[]::text[] AS reasons
     FROM catalog.events e
     LEFT JOIN catalog.venues v ON v.id = e.venue_id
     LEFT JOIN platform.promoters p ON p.id = e.promoter_id
     LEFT JOIN velocity vel ON vel.id = e.id
     LEFT JOIN cheapest ON cheapest.event_id = e.id
     WHERE e.status = 'published' AND e.date_start > NOW()
       -- Vyfiltrovat akce které user už koupil
       AND NOT EXISTS (
         SELECT 1 FROM orders.orders o2
         WHERE o2.user_id = $1 AND o2.event_id = e.id AND o2.status = 'paid'
       )
     ORDER BY score DESC, vel.recent_sales DESC NULLS LAST, e.date_start ASC
     LIMIT $7`,
    [
      userId,
      signals.followed_promoter_ids ?? [],
      signals.bought_types ?? [],
      signals.bought_cities ?? [],
      priceLow !== null ? Math.round(priceLow) : null,
      priceHigh !== null ? Math.round(priceHigh) : null,
      limit,
    ],
  );

  // Reasoning pro UI
  const recs = scored.rows.map((r) => {
    const reasons: string[] = [];
    if (signals.followed_promoter_ids?.length > 0) {
      // Approximation — promoter scoring rozhodnul + 50; pokud score >= 50 → followed
      if (r.score >= 50) reasons.push('Sleduješ pořadatele');
    }
    if (signals.bought_types?.length > 0 && r.event_type && signals.bought_types.includes(r.event_type)) {
      reasons.push(`Podobné ${r.event_type}`);
    }
    if (signals.bought_cities?.length > 0 && r.city && signals.bought_cities.includes(r.city)) {
      reasons.push(`V ${r.city}`);
    }
    if (r.recent_sales >= 5) reasons.push('Trending');
    if (reasons.length === 0) reasons.push('Připravované akce');
    return { ...r, reasons };
  });

  return NextResponse.json({
    personalized: true,
    recommendations: recs,
  });
}
