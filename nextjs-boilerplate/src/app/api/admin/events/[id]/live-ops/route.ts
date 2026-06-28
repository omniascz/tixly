/**
 * GET /api/admin/events/[id]/live-ops
 *
 * Live operations dashboard data:
 *   - Sales: total tickets sold, revenue, sold-out per type
 *   - Attendance: total scanned (unique tickets used or with redemption), per zone, per day
 *   - Scan rate: last 5/15/60 min counts (single-use 'used' transitions + multi-day redemptions)
 *   - Queue: tokens waiting + admitted (when queue_enabled)
 *   - Inventory: remaining_qty per ticket type
 *
 * Polling friendly — UI volá 5s, lehký query plan.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';


export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  // Ownership check
  const owns = await db().query<{ title: string; date_start: string; queue_enabled: boolean; currency: string }>(
    `SELECT title, date_start, queue_enabled, currency FROM catalog.events
     WHERE id = $1 AND promoter_id = $2`,
    [params.id, promoter.promoterId],
  );
  if (owns.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const ev = owns.rows[0];

  const [sales, scanRate, redemptionsByZone, redemptionsByDay, queue, inventory, gateStats] =
    await Promise.all([
      db().query<{ tickets_sold: string; revenue_halire: string; refunded_count: string }>(
        `SELECT
           COALESCE(SUM(oi.quantity), 0)::text AS tickets_sold,
           COALESCE(SUM(o.total_amount), 0)::text AS revenue_halire,
           COUNT(*) FILTER (WHERE o.status = 'refunded')::text AS refunded_count
         FROM orders.orders o
         LEFT JOIN orders.order_items oi ON oi.order_id = o.id
         WHERE o.event_id = $1 AND o.status IN ('paid', 'paid_partial', 'refunded')`,
        [params.id],
      ),
      db().query<{
        last5: string;
        last15: string;
        last60: string;
        used_total: string;
        redemption_total: string;
      }>(
        `WITH t AS (
           SELECT t.id, t.used_at, t.order_id
           FROM tickets.tickets t
           JOIN orders.orders o ON o.id = t.order_id
           WHERE o.event_id = $1
         )
         SELECT
           (SELECT COUNT(*) FROM t WHERE used_at > NOW() - INTERVAL '5 minutes')::text AS last5,
           (SELECT COUNT(*) FROM t WHERE used_at > NOW() - INTERVAL '15 minutes')::text AS last15,
           (SELECT COUNT(*) FROM t WHERE used_at > NOW() - INTERVAL '60 minutes')::text AS last60,
           (SELECT COUNT(*) FROM t WHERE used_at IS NOT NULL)::text AS used_total,
           (SELECT COUNT(*) FROM tickets.ticket_redemptions r
              JOIN t ON t.id = r.ticket_id)::text AS redemption_total`,
        [params.id],
      ),
      db().query<{ zone_id: string | null; zone_name: string; count: string }>(
        `SELECT z.id AS zone_id, z.name AS zone_name, COUNT(r.id)::text AS count
         FROM catalog.event_zones z
         LEFT JOIN tickets.ticket_redemptions r ON r.zone_id = z.id
         WHERE z.event_id = $1
         GROUP BY z.id, z.name
         ORDER BY z.display_order`,
        [params.id],
      ),
      db().query<{ event_day_id: string; label: string | null; starts_at: string; count: string }>(
        `SELECT d.id AS event_day_id, d.label, d.starts_at,
                COUNT(r.id)::text AS count
         FROM catalog.event_days d
         LEFT JOIN tickets.ticket_redemptions r ON r.event_day_id = d.id
         WHERE d.event_id = $1
         GROUP BY d.id
         ORDER BY d.day_index`,
        [params.id],
      ),
      db().query<{ status: string; count: string }>(
        `SELECT status, COUNT(*)::text AS count
         FROM platform.queue_tokens
         WHERE event_id = $1 AND status IN ('waiting', 'admitted')
         GROUP BY status`,
        [params.id],
      ),
      db().query<{
        id: string;
        name: string;
        total_qty: number | null;
        remaining_qty: number | null;
      }>(
        `SELECT id, name, total_qty, remaining_qty
         FROM catalog.ticket_types
         WHERE event_id = $1
         ORDER BY base_price ASC`,
        [params.id],
      ),
      db().query<{ gate_id: string | null; gate_label: string | null; admitted: string; denied: string }>(
        `SELECT
           sl.gate_id,
           g.label AS gate_label,
           COUNT(*) FILTER (WHERE sl.scan_result = 'admitted')::text AS admitted,
           COUNT(*) FILTER (WHERE sl.scan_result IN ('denied', 'already_used'))::text AS denied
         FROM tickets.scan_logs sl
         LEFT JOIN catalog.venue_gates g ON g.id = sl.gate_id
         WHERE sl.event_id = $1
         GROUP BY sl.gate_id, g.label
         ORDER BY admitted DESC NULLS LAST`,
        [params.id],
      ),
    ]);

  return NextResponse.json({
    event: {
      id: params.id,
      title: ev.title,
      dateStart: ev.date_start,
      queueEnabled: ev.queue_enabled,
      currency: ev.currency,
    },
    sales: {
      ticketsSold: Number(sales.rows[0]?.tickets_sold ?? 0),
      revenueHalire: Number(sales.rows[0]?.revenue_halire ?? 0),
      refundedCount: Number(sales.rows[0]?.refunded_count ?? 0),
    },
    scanRate: {
      last5min: Number(scanRate.rows[0]?.last5 ?? 0),
      last15min: Number(scanRate.rows[0]?.last15 ?? 0),
      last60min: Number(scanRate.rows[0]?.last60 ?? 0),
      usedTotal: Number(scanRate.rows[0]?.used_total ?? 0),
      redemptionTotal: Number(scanRate.rows[0]?.redemption_total ?? 0),
    },
    zones: redemptionsByZone.rows.map((z) => ({
      zoneId: z.zone_id,
      zoneName: z.zone_name,
      count: Number(z.count),
    })),
    days: redemptionsByDay.rows.map((d) => ({
      eventDayId: d.event_day_id,
      label: d.label,
      startsAt: d.starts_at,
      count: Number(d.count),
    })),
    queue: {
      waiting: Number(queue.rows.find((q) => q.status === 'waiting')?.count ?? 0),
      admitted: Number(queue.rows.find((q) => q.status === 'admitted')?.count ?? 0),
    },
    inventory: inventory.rows.map((i) => ({
      id: i.id,
      name: i.name,
      totalQty: i.total_qty,
      remainingQty: i.remaining_qty,
      soldQty: i.total_qty !== null && i.remaining_qty !== null ? i.total_qty - i.remaining_qty : null,
    })),
    gates: gateStats.rows.map((g) => ({
      gateId: g.gate_id,
      gateLabel: g.gate_label ?? (g.gate_id ? `Brána ${g.gate_id.slice(0, 8)}` : 'Web scanner'),
      admitted: Number(g.admitted),
      denied: Number(g.denied),
    })),
    timestamp: new Date().toISOString(),
  });

  });
}
