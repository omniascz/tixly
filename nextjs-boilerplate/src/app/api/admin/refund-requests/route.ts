/**
 * GET   /api/admin/refund-requests          — list pending pro promotéra
 * PATCH /api/admin/refund-requests/[id]     — approve / reject
 *
 * Promotér admin vidí frontu žádostí o refund (od buyerů, kteří nemohli self-service).
 * Schvaluje/zamítá ručně.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';


export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? 'pending';

  const r = await db().query<{
    id: string;
    order_id: string;
    user_id: string;
    status: string;
    reason: string;
    reason_category: string | null;
    requested_at: string;
    reviewed_at: string | null;
    reviewer_note: string | null;
    refunded_halire: number | null;
    order_total: number;
    order_currency: string;
    buyer_email: string;
    buyer_name: string | null;
    event_title: string | null;
    event_date_start: string | null;
  }>(
    `SELECT rr.id, rr.order_id, rr.user_id, rr.status, rr.reason, rr.reason_category,
            rr.requested_at, rr.reviewed_at, rr.reviewer_note, rr.refunded_halire,
            o.total_amount AS order_total, o.currency AS order_currency,
            u.email AS buyer_email, u.name AS buyer_name,
            e.title AS event_title, e.date_start AS event_date_start
     FROM orders.refund_requests rr
     JOIN orders.orders o ON o.id = rr.order_id
     LEFT JOIN identity.users u ON u.id = rr.user_id
     LEFT JOIN catalog.events e ON e.id = o.event_id
     WHERE rr.promoter_id = $1 AND ($2 = '' OR rr.status = $2)
     ORDER BY rr.requested_at DESC
     LIMIT 100`,
    [promoter.promoterId, status === 'all' ? '' : status],
  );

  return NextResponse.json({
    items: r.rows.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      userId: row.user_id,
      status: row.status,
      reason: row.reason,
      reasonCategory: row.reason_category,
      requestedAt: row.requested_at,
      reviewedAt: row.reviewed_at,
      reviewerNote: row.reviewer_note,
      refundedHalire: row.refunded_halire,
      orderTotalHalire: row.order_total,
      orderCurrency: row.order_currency,
      buyerEmail: row.buyer_email,
      buyerName: row.buyer_name,
      eventTitle: row.event_title,
      eventDateStart: row.event_date_start,
    })),
  });

  });
}
