/**
 * POST /api/internal/cron/audience-geo-snapshot
 *
 * Nightly rebuild of analytics.audience_geo from live orders.
 * Runs 02:00 UTC daily. Schedule: "0 2 * * *"
 *
 * Security: x-internal-token header required.
 */

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest): Promise<Response> {
  const token = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return runWithServiceContext(async () => {
    const result = await db().query<{ upserted: string }>(
      `INSERT INTO analytics.audience_geo (event_id, country_code, postal_code, buyer_count, updated_at)
       SELECT
         tt.event_id,
         COALESCE(o.billing_country_code, 'CZ') AS country_code,
         COALESCE(o.billing_postal_code, 'unknown') AS postal_code,
         COUNT(DISTINCT o.id) AS buyer_count,
         NOW() AS updated_at
       FROM orders.orders o
       JOIN orders.order_items oi ON oi.order_id = o.id
       JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
       WHERE o.status = 'paid'
         AND o.created_at > NOW() - INTERVAL '90 days'
       GROUP BY tt.event_id, country_code, postal_code
       ON CONFLICT (event_id, country_code, postal_code)
       DO UPDATE SET buyer_count = EXCLUDED.buyer_count, updated_at = NOW()
       RETURNING 'ok'`,
    );

    // Hourly sales snapshot for live dashboard sparklines
    await db().query(
      `INSERT INTO analytics.event_sales_snapshots
         (event_id, tickets_sold, revenue_total, unique_buyers)
       SELECT
         tt.event_id,
         SUM(oi.quantity)::int,
         SUM(o.total_amount)::bigint,
         COUNT(DISTINCT o.user_id)::int
       FROM orders.orders o
       JOIN orders.order_items oi ON oi.order_id = o.id
       JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
       WHERE o.status = 'paid'
         AND tt.event_id IN (
           SELECT id FROM catalog.events
           WHERE status = 'published' AND date_start > NOW()
         )
       GROUP BY tt.event_id
       ON CONFLICT (event_id, date_trunc('hour', NOW()))
       DO UPDATE SET
         tickets_sold = EXCLUDED.tickets_sold,
         revenue_total = EXCLUDED.revenue_total,
         unique_buyers = EXCLUDED.unique_buyers`,
    );

    // Expire stale party split sessions
    await db().query(
      `UPDATE orders.party_split_sessions
       SET status = 'expired', updated_at = NOW()
       WHERE status = 'open' AND expires_at < NOW()`,
    );

    return NextResponse.json({ ok: true, geoRows: result.rowCount });
  });
}
