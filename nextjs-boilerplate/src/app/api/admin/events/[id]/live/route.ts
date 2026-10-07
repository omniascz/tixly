/**
 * GET /api/admin/events/{id}/live
 *
 * Real-time prodejní dashboard pro promotéra.
 * Žádný z globálních konkurentů (TM/Eventbrite/EVENTIM) neposkytuje tento
 * level real-time přehledu malým a středním promotérům.
 *
 * Metriky:
 * - tickets_sold, tickets_remaining, capacity_total
 * - revenue_total (halíře), refunds_total
 * - velocity_1h: počet vstupenek prodaných za poslední hodinu
 * - velocity_24h: průměr za posledních 24 h
 * - forecast_sellout_at: odhad kdy se akce vyprodá (lineární regrese na 24h velocity)
 * - sell_through_pct: % prodaných
 * - top_ticket_type: nejprodávanější typ vstupenky
 * - hourly_breakdown: prodeje po hodinách (posledních 24 h) pro sparkline graf
 * - party_split_sessions: počet aktivních skupinových plateb
 *
 * Cache: 60 s (Vercel Edge Cache header), real-time on demand via ?nocache=1.
 *
 * Auth: promoter (active) — vlastní akce; platform admin — jakákoliv.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter, type PromoterContext } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

interface LiveRow {
  capacity_total: string;
  tickets_sold: string;
  revenue_total: string;
  refunds_total: string;
  velocity_1h: string;
  velocity_24h: string;
  date_start: string;
  event_title: string;
}

interface HourlyRow {
  hour: string;
  sold: string;
}

interface TopTTRow {
  ticket_type_name: string;
  sold: string;
}

interface PartySplitRow {
  active_sessions: string;
  pending_slots: string;
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  const eventId = params.id;

  return runAsActivePromoter(req, async (_ctx: PromoterContext) => {
    const [liveRes, hourlyRes, topTTRes, partyRes] = await Promise.all([
      db().query<LiveRow>(
        `WITH totals AS (
           SELECT
             COALESCE(SUM(tt.total_qty), 0)         AS capacity_total,
             COALESCE(SUM(
               tt.total_qty - tt.remaining_qty
             ), 0)                                   AS tickets_sold,
             COALESCE(SUM(o.total_amount) FILTER (
               WHERE o.status = 'paid'
             ), 0)                                   AS revenue_total,
             COALESCE(SUM(o.total_amount) FILTER (
               WHERE o.status = 'refunded'
             ), 0)                                   AS refunds_total
           FROM catalog.ticket_types tt
           LEFT JOIN orders.order_items oi ON oi.ticket_type_id = tt.id
           LEFT JOIN orders.orders o ON o.id = oi.order_id
           WHERE tt.event_id = $1
         ),
         velocity AS (
           SELECT
             COUNT(*) FILTER (
               WHERE o.status = 'paid' AND o.created_at > NOW() - INTERVAL '1 hour'
             ) AS velocity_1h,
             COUNT(*) FILTER (
               WHERE o.status = 'paid' AND o.created_at > NOW() - INTERVAL '24 hours'
             ) / 24.0 AS velocity_24h
           FROM orders.orders o
           WHERE o.event_id = $1
         )
         SELECT t.capacity_total, t.tickets_sold, t.revenue_total, t.refunds_total,
                v.velocity_1h, v.velocity_24h,
                e.date_start,
                COALESCE(pr.title, e.title) AS event_title
         FROM totals t, velocity v
         JOIN catalog.events e ON e.id = $1
         LEFT JOIN catalog.productions pr ON pr.id = e.production_id`,
        [eventId],
      ),

      db().query<HourlyRow>(
        `SELECT date_trunc('hour', o.created_at) AS hour,
                COUNT(oi.id) AS sold
         FROM orders.orders o
         JOIN orders.order_items oi ON oi.order_id = o.id
         JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
         WHERE tt.event_id = $1
           AND o.status = 'paid'
           AND o.created_at > NOW() - INTERVAL '24 hours'
         GROUP BY 1
         ORDER BY 1`,
        [eventId],
      ),

      db().query<TopTTRow>(
        `SELECT tt.name AS ticket_type_name, SUM(oi.quantity) AS sold
         FROM orders.order_items oi
         JOIN orders.orders o ON o.id = oi.order_id
         JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
         WHERE tt.event_id = $1 AND o.status = 'paid'
         GROUP BY tt.name
         ORDER BY sold DESC
         LIMIT 3`,
        [eventId],
      ),

      db().query<PartySplitRow>(
        `SELECT COUNT(*) FILTER (WHERE status = 'open') AS active_sessions,
                COALESCE(SUM(
                  (SELECT COUNT(*) FROM orders.party_split_slots sl
                   WHERE sl.session_id = ps.id AND sl.status = 'pending')
                ), 0) AS pending_slots
         FROM orders.party_split_sessions ps
         WHERE ps.event_id = $1`,
        [eventId],
      ),
    ]);

    if (liveRes.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const live = liveRes.rows[0];
    const capacityTotal = Number(live.capacity_total);
    const ticketsSold = Number(live.tickets_sold);
    const ticketsRemaining = Math.max(0, capacityTotal - ticketsSold);
    const velocity24h = Number(live.velocity_24h); // tickets per hour average

    // Forecast sell-out: when will remaining tickets be gone at current velocity?
    let forecastSelloutAt: string | null = null;
    if (velocity24h > 0 && ticketsRemaining > 0) {
      const hoursToSellout = ticketsRemaining / velocity24h;
      forecastSelloutAt = new Date(Date.now() + hoursToSellout * 3600 * 1000).toISOString();
      // Cap forecast at event date
      if (live.date_start && new Date(forecastSelloutAt) > new Date(live.date_start)) {
        forecastSelloutAt = null; // won't sell out before event
      }
    }

    return NextResponse.json(
      {
        eventId,
        eventTitle: live.event_title,
        dateStart: live.date_start,

        // Inventory
        capacityTotal,
        ticketsSold,
        ticketsRemaining,
        sellThroughPct: capacityTotal > 0
          ? Math.round((ticketsSold / capacityTotal) * 100 * 10) / 10
          : 0,

        // Revenue
        revenueTotal: Number(live.revenue_total),
        refundsTotal: Number(live.refunds_total),
        netRevenue: Number(live.revenue_total) - Number(live.refunds_total),

        // Velocity
        velocity1h: Number(live.velocity_1h),
        velocity24hAvg: Math.round(velocity24h * 10) / 10,
        forecastSelloutAt,

        // Breakdown
        topTicketTypes: topTTRes.rows.map((r) => ({
          name: r.ticket_type_name,
          sold: Number(r.sold),
        })),

        // 24h sparkline (hourly buckets)
        hourlyBreakdown: hourlyRes.rows.map((r) => ({
          hour: r.hour,
          sold: Number(r.sold),
        })),

        // Party Pay stats
        partySplit: {
          activeSessions: Number(partyRes.rows[0]?.active_sessions ?? 0),
          pendingSlots:   Number(partyRes.rows[0]?.pending_slots ?? 0),
        },
      },
      {
        headers: {
          'Cache-Control': req.nextUrl.searchParams.has('nocache')
            ? 'no-store'
            : 'private, max-age=60',
        },
      },
    );
  });
}
