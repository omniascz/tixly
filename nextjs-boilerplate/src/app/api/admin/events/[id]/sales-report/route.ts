/**
 * GET /api/admin/events/[id]/sales-report
 *
 * Detailed revenue breakdown:
 *   - Per ticket type: sold_qty, gross, discounts
 *   - Add-ons total
 *   - Bundles total
 *   - Insurance premiums collected
 *   - Refunds
 *   - Daily sales chart (last 30 days)
 *
 * Query: ?format=json (default) | ?format=csv (full order ledger CSV export)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';


function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const owns = await db().query<{ title: string; currency: string }>(
    `SELECT title, currency FROM catalog.events
     WHERE id = $1 AND promoter_id = $2`,
    [params.id, promoter.promoterId],
  );
  if (owns.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const event = owns.rows[0];
  const format = req.nextUrl.searchParams.get('format');

  if (format === 'csv') {
    const rows = await db().query<{
      order_id: string;
      created_at: string;
      paid_at: string | null;
      status: string;
      buyer_email: string;
      buyer_name: string | null;
      ticket_type_name: string | null;
      quantity: number | null;
      unit_price: number | null;
      total_price: number | null;
      total_amount: number;
      discount_halire: number;
      currency: string;
      promo_code: string | null;
      payment_provider: string | null;
    }>(
      `SELECT o.id AS order_id, o.created_at, o.paid_at, o.status,
              u.email AS buyer_email, u.name AS buyer_name,
              tt.name AS ticket_type_name,
              oi.quantity, oi.unit_price, oi.total_price,
              o.total_amount, o.discount_halire, o.currency,
              pc.code AS promo_code,
              o.payment_provider
       FROM orders.orders o
       JOIN identity.users u ON u.id = o.user_id
       LEFT JOIN orders.order_items oi ON oi.order_id = o.id
       LEFT JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
       LEFT JOIN marketing.promo_codes pc ON pc.id = o.promo_code_id
       WHERE o.event_id = $1
       ORDER BY o.created_at DESC`,
      [params.id],
    );

    const header = [
      'order_id',
      'created_at',
      'paid_at',
      'status',
      'buyer_email',
      'buyer_name',
      'ticket_type',
      'quantity',
      'unit_price_minor',
      'line_total_minor',
      'order_total_minor',
      'discount_minor',
      'currency',
      'promo_code',
      'payment_provider',
    ].join(',');

    const lines = rows.rows.map((r) =>
      [
        r.order_id,
        r.created_at,
        r.paid_at ?? '',
        r.status,
        r.buyer_email,
        r.buyer_name ?? '',
        r.ticket_type_name ?? '',
        r.quantity ?? '',
        r.unit_price ?? '',
        r.total_price ?? '',
        r.total_amount,
        r.discount_halire,
        r.currency,
        r.promo_code ?? '',
        r.payment_provider ?? '',
      ]
        .map(csvEscape)
        .join(','),
    );

    const csv = [header, ...lines].join('\n');
    const filename = `tixly-${event.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  // JSON breakdown
  const [byType, addons, bundles, insurance, refunds, daily] = await Promise.all([
    db().query<{
      ticket_type_id: string;
      name: string;
      sold_qty: string;
      gross_halire: string;
      total_qty: number;
      remaining_qty: number;
    }>(
      `SELECT tt.id AS ticket_type_id, tt.name,
              tt.total_qty, tt.remaining_qty,
              COALESCE(SUM(oi.quantity), 0)::text AS sold_qty,
              COALESCE(SUM(oi.total_price), 0)::text AS gross_halire
       FROM catalog.ticket_types tt
       LEFT JOIN orders.order_items oi ON oi.ticket_type_id = tt.id
       LEFT JOIN orders.orders o ON o.id = oi.order_id
         AND o.status IN ('paid', 'paid_partial')
       WHERE tt.event_id = $1
       GROUP BY tt.id, tt.name, tt.total_qty, tt.remaining_qty
       ORDER BY tt.base_price ASC`,
      [params.id],
    ),
    db().query<{ count: string; total: string }>(
      `SELECT COUNT(oa.id)::text AS count, COALESCE(SUM(oa.subtotal_halire), 0)::text AS total
       FROM public.order_addons oa
       JOIN orders.orders o ON o.id = oa.order_id
       WHERE o.event_id = $1 AND o.status IN ('paid', 'paid_partial')`,
      [params.id],
    ),
    db().query<{ count: string; total: string }>(
      `SELECT COUNT(DISTINCT o.id)::text AS count,
              COALESCE(SUM(o.total_amount), 0)::text AS total
       FROM orders.orders o
       WHERE o.event_id = $1 AND o.status IN ('paid', 'paid_partial')`,
      [params.id],
    ),
    db().query<{ count: string; premium_total: string }>(
      `SELECT COUNT(*)::text AS count, COALESCE(SUM(ins.premium_amount), 0)::text AS premium_total
       FROM orders.order_insurance ins
       JOIN orders.orders o ON o.id = ins.order_id
       WHERE o.event_id = $1 AND ins.status IN ('active', 'claimed')`,
      [params.id],
    ),
    db().query<{ count: string; total: string }>(
      `SELECT COUNT(*)::text AS count, COALESCE(SUM(total_amount), 0)::text AS total
       FROM orders.orders
       WHERE event_id = $1 AND status = 'refunded'`,
      [params.id],
    ),
    db().query<{ day: string; count: string; revenue: string }>(
      `SELECT DATE(paid_at) AS day,
              COUNT(*)::text AS count,
              COALESCE(SUM(total_amount), 0)::text AS revenue
       FROM orders.orders
       WHERE event_id = $1 AND status IN ('paid', 'paid_partial')
         AND paid_at > NOW() - INTERVAL '30 days'
       GROUP BY DATE(paid_at)
       ORDER BY day DESC
       LIMIT 30`,
      [params.id],
    ),
  ]);

  return NextResponse.json({
    event: { id: params.id, title: event.title, currency: event.currency },
    byTicketType: byType.rows.map((r) => ({
      ticketTypeId: r.ticket_type_id,
      name: r.name,
      soldQty: Number(r.sold_qty),
      grossHalire: Number(r.gross_halire),
      totalQty: r.total_qty,
      remainingQty: r.remaining_qty,
      occupancyPct: r.total_qty > 0 ? Math.round((r.total_qty - r.remaining_qty) / r.total_qty * 100) : 0,
    })),
    addons: {
      count: Number(addons.rows[0]?.count ?? 0),
      totalHalire: Number(addons.rows[0]?.total ?? 0),
    },
    grossOrders: {
      count: Number(bundles.rows[0]?.count ?? 0),
      totalHalire: Number(bundles.rows[0]?.total ?? 0),
    },
    insurance: {
      count: Number(insurance.rows[0]?.count ?? 0),
      premiumTotalHalire: Number(insurance.rows[0]?.premium_total ?? 0),
    },
    refunds: {
      count: Number(refunds.rows[0]?.count ?? 0),
      totalHalire: Number(refunds.rows[0]?.total ?? 0),
    },
    dailySales: daily.rows.map((d) => ({
      day: d.day,
      count: Number(d.count),
      revenueHalire: Number(d.revenue),
    })),
  });

  });
}
