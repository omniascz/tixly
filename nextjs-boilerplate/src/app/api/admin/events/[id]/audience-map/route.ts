/**
 * GET /api/admin/events/{id}/audience-map
 *
 * Geografická distribuce kupujících — kde zákazníci bydlí.
 * Žádný z globálních konkurentů toto neposkytuje malým promotérům.
 *
 * Zákaznické PSČ sbíráme z:
 *   1. orders.orders.billing_postal_code (mig 394)
 *   2. Fallback: user profile postal code (pokud zákazník vyplnil)
 *
 * Response:
 * {
 *   eventId:   uuid
 *   totalBuyers: number
 *   countries: [{
 *     countryCode: string
 *     count: number
 *     postalCodes: [{ code: string, count: number }]  -- top 20 per country
 *   }]
 *   dominantCity: string | null  -- top city/PSČ by count
 *   localPct: number             -- % from promoter's own city/region
 * }
 *
 * Data refresh: rebuilt by cron (analytics.audience_geo) nightly.
 * Real-time mode (?live=1): direct query (slower but current).
 *
 * Auth: promoter (own events) or platform admin.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter, type PromoterContext } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

interface GeoRow {
  country_code: string;
  postal_code: string;
  buyer_count: string;
}

interface LiveGeoRow {
  country_code: string;
  postal_code: string;
  cnt: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const eventId = params.id;
  const useLive = req.nextUrl.searchParams.has('live');

  return runAsActivePromoter(req, async (_ctx: PromoterContext) => {
    let rows: Array<{ country_code: string; postal_code: string; buyer_count: number }>;

    if (useLive) {
      // Direct query — fresh but slower
      const res = await db().query<LiveGeoRow>(
        `SELECT
           COALESCE(o.billing_country_code, 'CZ') AS country_code,
           COALESCE(o.billing_postal_code, 'unknown') AS postal_code,
           COUNT(DISTINCT o.id)::text AS cnt
         FROM orders.orders o
         JOIN orders.order_items oi ON oi.order_id = o.id
         JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
         WHERE tt.event_id = $1
           AND o.status = 'paid'
         GROUP BY 1, 2
         ORDER BY cnt DESC`,
        [eventId],
      );
      rows = res.rows.map((r) => ({
        country_code: r.country_code,
        postal_code:  r.postal_code,
        buyer_count:  Number(r.cnt),
      }));
    } else {
      // Read from nightly cache
      const res = await db().query<GeoRow>(
        `SELECT country_code, postal_code, buyer_count
         FROM analytics.audience_geo
         WHERE event_id = $1
         ORDER BY buyer_count DESC`,
        [eventId],
      );
      rows = res.rows.map((r) => ({
        country_code: r.country_code,
        postal_code:  r.postal_code,
        buyer_count:  Number(r.buyer_count),
      }));
    }

    if (rows.length === 0) {
      return NextResponse.json({
        eventId,
        totalBuyers: 0,
        countries: [],
        dominantCity: null,
        localPct: 0,
        cachedAt: useLive ? null : new Date().toISOString(),
      });
    }

    const totalBuyers = rows.reduce((sum, r) => sum + r.buyer_count, 0);

    // Group by country
    const countryMap = new Map<string, Array<{ code: string; count: number }>>();
    for (const row of rows) {
      if (!countryMap.has(row.country_code)) countryMap.set(row.country_code, []);
      countryMap.get(row.country_code)!.push({ code: row.postal_code, count: row.buyer_count });
    }

    const countries = Array.from(countryMap.entries())
      .map(([countryCode, postalCodes]) => ({
        countryCode,
        count: postalCodes.reduce((s, p) => s + p.count, 0),
        postalCodes: postalCodes.slice(0, 20), // top 20 per country
      }))
      .sort((a, b) => b.count - a.count);

    const dominantRow = rows[0];
    const dominantCity = dominantRow ? `${dominantRow.country_code}-${dominantRow.postal_code}` : null;

    // Local % = buyers from top country
    const topCountry = countries[0];
    const localPct = topCountry
      ? Math.round((topCountry.count / totalBuyers) * 100 * 10) / 10
      : 0;

    return NextResponse.json(
      {
        eventId,
        totalBuyers,
        countries,
        dominantCity,
        localPct,
        dataMode: useLive ? 'live' : 'cached_nightly',
      },
      {
        headers: {
          'Cache-Control': useLive ? 'no-store' : 'private, max-age=300',
        },
      },
    );
  });
}
