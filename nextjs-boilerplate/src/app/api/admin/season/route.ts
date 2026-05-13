/**
 * GET /api/admin/season?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Sezónní dashboard — per-event row pro všechny published akce promotéra
 * v daném období. Aggregace na serveru.
 *
 * Default: posledních 30 dní + nadcházejících 90 dní.
 *
 * Sloupce pro každou akci:
 *   - id, title, dateStart, venueName
 *   - totalCapacity (sum ticket_types.total_qty)
 *   - soldQty (sum order_items.quantity WHERE status=paid)
 *   - occupancyPct
 *   - grossRevenueHalire
 *   - refundedHalire
 *   - daysToEvent (- pro minulé)
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface EventRow {
  id: string;
  title: string;
  date_start: string;
  venue_name: string | null;
  total_capacity: number;
  sold_qty: string;
  gross_halire: string;
  refunded_halire: string;
  orders_count: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = req.nextUrl;
  const defFrom = new Date();
  defFrom.setDate(defFrom.getDate() - 30);
  const defTo = new Date();
  defTo.setDate(defTo.getDate() + 90);
  const from = url.searchParams.get('from') ?? defFrom.toISOString().slice(0, 10);
  const to = url.searchParams.get('to') ?? defTo.toISOString().slice(0, 10);

  const r = await db().query<EventRow>(
    `SELECT
       e.id, e.title, e.date_start,
       v.name AS venue_name,
       COALESCE((SELECT SUM(total_qty) FROM catalog.ticket_types WHERE event_id = e.id), 0)::int AS total_capacity,
       COALESCE((
         SELECT SUM(oi.quantity)
         FROM orders.order_items oi
         JOIN orders.orders o ON o.id = oi.order_id
         WHERE o.event_id = e.id AND o.status IN ('paid','paid_partial')
       ), 0)::text AS sold_qty,
       COALESCE((
         SELECT SUM(total_amount) FROM orders.orders
         WHERE event_id = e.id AND status IN ('paid','paid_partial')
       ), 0)::text AS gross_halire,
       COALESCE((
         SELECT SUM(total_amount) FROM orders.orders
         WHERE event_id = e.id AND status = 'refunded'
       ), 0)::text AS refunded_halire,
       COALESCE((
         SELECT COUNT(*) FROM orders.orders
         WHERE event_id = e.id AND status IN ('paid','paid_partial')
       ), 0)::text AS orders_count
     FROM catalog.events e
     LEFT JOIN catalog.venues v ON v.id = e.venue_id
     WHERE e.promoter_id = $1
       AND e.status = 'published'
       AND e.date_start::date BETWEEN $2::date AND $3::date
     ORDER BY e.date_start ASC`,
    [promoter.promoterId, from, to],
  );

  const now = Date.now();
  const events = r.rows.map((row) => {
    const sold = Number(row.sold_qty);
    const cap = row.total_capacity;
    const occupancyPct = cap > 0 ? Math.round((sold / cap) * 100) : 0;
    const dt = new Date(row.date_start).getTime();
    const daysToEvent = Math.round((dt - now) / 86_400_000);
    return {
      id: row.id,
      title: row.title,
      dateStart: row.date_start,
      venueName: row.venue_name,
      totalCapacity: cap,
      soldQty: sold,
      occupancyPct,
      grossRevenueHalire: Number(row.gross_halire),
      refundedHalire: Number(row.refunded_halire),
      ordersCount: Number(row.orders_count),
      daysToEvent,
    };
  });

  // Aggregate stats
  const totalGross = events.reduce((s, e) => s + e.grossRevenueHalire, 0);
  const totalRefunded = events.reduce((s, e) => s + e.refundedHalire, 0);
  const totalSold = events.reduce((s, e) => s + e.soldQty, 0);
  const totalCapacity = events.reduce((s, e) => s + e.totalCapacity, 0);
  const overallOccupancy = totalCapacity > 0 ? Math.round((totalSold / totalCapacity) * 100) : 0;

  return NextResponse.json({
    events,
    summary: {
      totalEvents: events.length,
      totalGrossHalire: totalGross,
      totalRefundedHalire: totalRefunded,
      totalNetHalire: totalGross - totalRefunded,
      totalSold,
      totalCapacity,
      overallOccupancyPct: overallOccupancy,
    },
    range: { from, to },
  });
}
