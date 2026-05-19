/**
 * GET /api/platform/analytics
 *
 * Master admin overview: cross-promoter aggregations.
 *   - Total revenue, total tickets sold, active promoters, active events
 *   - Top promoters by revenue (last 30 days)
 *   - Conversion rate (paid / total orders)
 *   - Fraud rate (blocked / scored orders)
 *   - Refund rate (refunded / paid)
 *   - Daily revenue chart (30 days)
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePlatformAdmin } from '@/lib/platform-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function GET(req: NextRequest): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const [overview, topPromoters, daily, fraudStats, conversion] = await Promise.all([
    db().query<{
      total_revenue: string;
      total_tickets: string;
      active_promoters: string;
      active_events: string;
    }>(
      `SELECT
         (SELECT COALESCE(SUM(total_amount), 0)::text FROM orders.orders
          WHERE status IN ('paid', 'paid_partial')
            AND paid_at > NOW() - INTERVAL '30 days') AS total_revenue,
         (SELECT COALESCE(SUM(quantity), 0)::text FROM orders.order_items oi
          JOIN orders.orders o ON o.id = oi.order_id
          WHERE o.status IN ('paid', 'paid_partial')
            AND o.paid_at > NOW() - INTERVAL '30 days') AS total_tickets,
         (SELECT COUNT(*)::text FROM platform.promoters WHERE status = 'active') AS active_promoters,
         (SELECT COUNT(*)::text FROM catalog.events WHERE status = 'published'
            AND date_start > NOW()) AS active_events`,
    ),
    db().query<{
      promoter_id: string;
      promoter_name: string;
      revenue: string;
      tickets: string;
      events: string;
    }>(
      `SELECT p.id AS promoter_id, p.name AS promoter_name,
              COALESCE(SUM(o.total_amount), 0)::text AS revenue,
              COALESCE(SUM(oi.quantity), 0)::text AS tickets,
              (SELECT COUNT(*)::text FROM catalog.events e
               WHERE e.promoter_id = p.id AND e.status = 'published') AS events
       FROM platform.promoters p
       LEFT JOIN catalog.events e ON e.promoter_id = p.id
       LEFT JOIN orders.orders o ON o.event_id = e.id
         AND o.status IN ('paid', 'paid_partial')
         AND o.paid_at > NOW() - INTERVAL '30 days'
       LEFT JOIN orders.order_items oi ON oi.order_id = o.id
       WHERE p.status = 'active'
       GROUP BY p.id, p.name
       ORDER BY revenue DESC NULLS LAST
       LIMIT 10`,
    ),
    db().query<{ day: string; revenue: string; orders: string }>(
      `SELECT DATE(paid_at) AS day,
              COALESCE(SUM(total_amount), 0)::text AS revenue,
              COUNT(*)::text AS orders
       FROM orders.orders
       WHERE status IN ('paid', 'paid_partial')
         AND paid_at > NOW() - INTERVAL '30 days'
       GROUP BY DATE(paid_at)
       ORDER BY day DESC`,
    ),
    db().query<{
      total_scored: string;
      blocked: string;
      review: string;
      avg_score: string | null;
    }>(
      `SELECT
         COUNT(*)::text AS total_scored,
         COUNT(*) FILTER (WHERE fraud_decision = 'block')::text AS blocked,
         COUNT(*) FILTER (WHERE fraud_decision = 'review')::text AS review,
         AVG(fraud_score)::text AS avg_score
       FROM orders.orders
       WHERE fraud_score IS NOT NULL
         AND created_at > NOW() - INTERVAL '30 days'`,
    ),
    db().query<{
      total_orders: string;
      paid_orders: string;
      refunded_orders: string;
    }>(
      `SELECT
         COUNT(*)::text AS total_orders,
         COUNT(*) FILTER (WHERE status IN ('paid', 'paid_partial'))::text AS paid_orders,
         COUNT(*) FILTER (WHERE status = 'refunded')::text AS refunded_orders
       FROM orders.orders
       WHERE created_at > NOW() - INTERVAL '30 days'`,
    ),
  ]);

  const ov = overview.rows[0];
  const co = conversion.rows[0];
  const fr = fraudStats.rows[0];

  return NextResponse.json({
    overview: {
      totalRevenueHalire: Number(ov.total_revenue),
      totalTicketsSold: Number(ov.total_tickets),
      activePromoters: Number(ov.active_promoters),
      activeEvents: Number(ov.active_events),
      windowDays: 30,
    },
    topPromoters: topPromoters.rows.map((p) => ({
      promoterId: p.promoter_id,
      promoterName: p.promoter_name,
      revenueHalire: Number(p.revenue ?? 0),
      ticketsSold: Number(p.tickets ?? 0),
      eventsCount: Number(p.events ?? 0),
    })),
    daily: daily.rows.map((d) => ({
      day: d.day,
      revenueHalire: Number(d.revenue),
      orders: Number(d.orders),
    })),
    conversion: {
      totalOrders: Number(co.total_orders),
      paidOrders: Number(co.paid_orders),
      refundedOrders: Number(co.refunded_orders),
      conversionRatePct:
        Number(co.total_orders) > 0
          ? Math.round((Number(co.paid_orders) / Number(co.total_orders)) * 100)
          : 0,
      refundRatePct:
        Number(co.paid_orders) > 0
          ? Math.round((Number(co.refunded_orders) / Number(co.paid_orders)) * 100)
          : 0,
    },
    fraud: {
      totalScored: Number(fr.total_scored ?? 0),
      blockedCount: Number(fr.blocked ?? 0),
      reviewCount: Number(fr.review ?? 0),
      avgScore: fr.avg_score !== null ? Number(fr.avg_score) : null,
      blockRatePct:
        Number(fr.total_scored ?? 0) > 0
          ? Math.round((Number(fr.blocked) / Number(fr.total_scored)) * 100)
          : 0,
    },
  });
}
