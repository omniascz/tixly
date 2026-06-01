/**
 * GET /api/admin/events/[id]/analytics
 *
 * Promotér event insight — heat-map analytics:
 *   - Sales curve (per day v posledních 90 dnech)
 *   - Sales per hour-of-day distribution
 *   - Sector occupancy (% sold + revenue)
 *   - Ticket type breakdown
 *   - Conversion funnel (visitors → cart → paid)
 *   - Average order value, refund rate
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';


export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: 'BAD_EVENT' }, { status: 422 });
  }

  const own = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM catalog.events
     WHERE id = $1 AND promoter_id = $2`,
    [params.id, promoter.promoterId],
  );
  if (Number(own.rows[0]?.count ?? 0) === 0) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  // 1) Sales curve (per day last 90)
  const salesCurve = await db().query<{ day: string; orders: string; gross: string }>(
    `WITH days AS (
       SELECT generate_series(DATE_TRUNC('day', NOW() - INTERVAL '90 days'), DATE_TRUNC('day', NOW()), '1 day') AS d
     )
     SELECT d.d::date::text AS day,
            COUNT(o.id)::text AS orders,
            COALESCE(SUM(o.total_amount), 0)::text AS gross
     FROM days d
     LEFT JOIN orders.orders o ON DATE_TRUNC('day', o.paid_at) = d.d
       AND o.event_id = $1 AND o.status = 'paid'
     GROUP BY d.d
     ORDER BY d.d ASC`,
    [params.id],
  );

  // 2) Hour-of-day distribution
  const hourDist = await db().query<{ hour: string; count: string }>(
    `SELECT EXTRACT(HOUR FROM paid_at AT TIME ZONE 'Europe/Prague')::text AS hour,
            COUNT(*)::text AS count
     FROM orders.orders
     WHERE event_id = $1 AND status = 'paid'
     GROUP BY hour
     ORDER BY hour::int ASC`,
    [params.id],
  );

  // 3) Sector occupancy (seated events)
  const sectors = await db().query<{
    sector: string;
    total: string;
    sold: string;
    held: string;
    available: string;
    avg_price: string | null;
  }>(
    `SELECT
       es.sector,
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE es.status = 'sold')::text AS sold,
       COUNT(*) FILTER (WHERE es.status = 'held')::text AS held,
       COUNT(*) FILTER (WHERE es.status = 'available')::text AS available,
       AVG(tt.base_price)::text AS avg_price
     FROM catalog.event_seats es
     LEFT JOIN catalog.ticket_types tt ON tt.id = es.ticket_type_id
     WHERE es.event_id = $1
     GROUP BY es.sector
     ORDER BY es.sector`,
    [params.id],
  );

  // 4) Ticket type breakdown
  const ticketTypes = await db().query<{
    name: string;
    sold_qty: string;
    revenue: string;
    avg_price: string;
    remaining: string;
    total: string;
  }>(
    `SELECT tt.name,
            COALESCE(SUM(oi.quantity), 0)::text AS sold_qty,
            COALESCE(SUM(oi.total_price), 0)::text AS revenue,
            tt.base_price::text AS avg_price,
            tt.remaining_qty::text AS remaining,
            tt.total_qty::text AS total
     FROM catalog.ticket_types tt
     LEFT JOIN orders.order_items oi ON oi.ticket_type_id = tt.id
     LEFT JOIN orders.orders o ON o.id = oi.order_id AND o.status = 'paid'
     WHERE tt.event_id = $1
     GROUP BY tt.id, tt.name, tt.base_price, tt.remaining_qty, tt.total_qty
     ORDER BY tt.base_price DESC`,
    [params.id],
  );

  // 5) Aggregate KPI
  const kpi = await db().query<{
    total_revenue: string;
    total_orders: string;
    paid_orders: string;
    refunded_orders: string;
    avg_order_value: string;
    rsvp_interested: string;
  }>(
    `SELECT
       COALESCE(SUM(o.total_amount) FILTER (WHERE o.status = 'paid'), 0)::text AS total_revenue,
       COUNT(*)::text AS total_orders,
       COUNT(*) FILTER (WHERE o.status = 'paid')::text AS paid_orders,
       COUNT(*) FILTER (WHERE o.status = 'refunded')::text AS refunded_orders,
       COALESCE(AVG(o.total_amount) FILTER (WHERE o.status = 'paid'), 0)::text AS avg_order_value,
       (SELECT COUNT(*)::text FROM marketing.event_rsvps
        WHERE event_id = $1 AND status = 'interested') AS rsvp_interested
     FROM orders.orders o
     WHERE o.event_id = $1`,
    [params.id],
  );

  const k = kpi.rows[0];

  return NextResponse.json({
    eventId: params.id,
    kpi: {
      totalRevenueHalire: Number(k.total_revenue),
      totalOrders: Number(k.total_orders),
      paidOrders: Number(k.paid_orders),
      refundedOrders: Number(k.refunded_orders),
      avgOrderValueHalire: Math.round(Number(k.avg_order_value)),
      rsvpInterested: Number(k.rsvp_interested),
      refundRatePct:
        Number(k.paid_orders) + Number(k.refunded_orders) > 0
          ? Math.round(
              (Number(k.refunded_orders) /
                (Number(k.paid_orders) + Number(k.refunded_orders))) *
                100,
            )
          : 0,
    },
    salesCurve: salesCurve.rows.map((r) => ({
      day: r.day,
      orders: Number(r.orders),
      grossHalire: Number(r.gross),
    })),
    hourOfDay: hourDist.rows.map((r) => ({
      hour: Number(r.hour),
      orders: Number(r.count),
    })),
    sectors: sectors.rows.map((r) => ({
      sector: r.sector,
      total: Number(r.total),
      sold: Number(r.sold),
      held: Number(r.held),
      available: Number(r.available),
      occupancyPct:
        Number(r.total) > 0 ? Math.round((Number(r.sold) / Number(r.total)) * 100) : 0,
      avgPriceHalire: r.avg_price ? Math.round(Number(r.avg_price)) : null,
    })),
    ticketTypes: ticketTypes.rows.map((r) => ({
      name: r.name,
      soldQty: Number(r.sold_qty),
      revenueHalire: Number(r.revenue),
      avgPriceHalire: Number(r.avg_price),
      remaining: Number(r.remaining),
      total: Number(r.total),
      occupancyPct:
        Number(r.total) > 0
          ? Math.round(((Number(r.total) - Number(r.remaining)) / Number(r.total)) * 100)
          : 0,
    })),
  });

  });
}
