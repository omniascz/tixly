/**
 * POST /api/buyer/refund-requests
 *
 * Kupec žádá o refund mimo self-service okno (po deadlinu, mimořádné okolnosti).
 * Tixly / promotér potom manuálně schválí nebo zamítne.
 *
 * Body: { orderId, reason, reasonCategory?, ticketIds? }
 *
 * GET /api/buyer/refund-requests — buyer vidí seznam svých requestů.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { notifyPromoter } from '@/lib/notifications/promoter-notify';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const createSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().min(10).max(2000),
  reasonCategory: z
    .enum([
      'illness',
      'family_emergency',
      'travel_disruption',
      'duplicate_purchase',
      'event_changed',
      'other',
    ])
    .optional(),
  ticketIds: z.array(z.string().uuid()).max(50).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BAD_INPUT', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;

  // Order musí patřit user-id + být v paid stavu
  const orderRes = await db().query<{
    id: string;
    status: string;
    promoter_id: string | null;
  }>(
    `SELECT o.id, o.status, e.promoter_id
     FROM orders.orders o
     LEFT JOIN catalog.events e ON e.id = o.event_id
     WHERE o.id = $1 AND o.user_id = $2`,
    [input.orderId, userId],
  );
  if (orderRes.rows.length === 0) {
    return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 });
  }
  const order = orderRes.rows[0];
  if (order.status !== 'paid') {
    return NextResponse.json(
      { error: 'INVALID_ORDER_STATUS', currentStatus: order.status },
      { status: 409 },
    );
  }
  if (!order.promoter_id) {
    return NextResponse.json({ error: 'NO_PROMOTER' }, { status: 422 });
  }

  // Duplicate check — max 1 pending request per order
  const existingRes = await db().query<{ id: string }>(
    `SELECT id FROM orders.refund_requests
     WHERE order_id = $1 AND status = 'pending'`,
    [input.orderId],
  );
  if (existingRes.rows.length > 0) {
    return NextResponse.json(
      {
        error: 'DUPLICATE_REQUEST',
        message: 'Žádost o refund je už ve frontě. Vyčkej na odpověď.',
        existingId: existingRes.rows[0].id,
      },
      { status: 409 },
    );
  }

  const ins = await db().query<{ id: string }>(
    `INSERT INTO orders.refund_requests
       (order_id, user_id, promoter_id, reason, reason_category, ticket_ids)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      input.orderId,
      userId,
      order.promoter_id,
      input.reason,
      input.reasonCategory ?? null,
      input.ticketIds ?? null,
    ],
  );

  // Notify promoter — best effort, nelogovat refund queue insert na chybě notif.
  try {
    await notifyPromoter({
      promoterId: order.promoter_id,
      kind: 'refund_request',
      severity: 'warn',
      title: 'Nová žádost o vrácení peněz',
      body: input.reason.slice(0, 200),
      link: '/admin/refund-requests',
      payload: { requestId: ins.rows[0].id, orderId: input.orderId },
    });
  } catch {
    // ignore
  }

  return NextResponse.json({ ok: true, requestId: ins.rows[0].id }, { status: 201 });
}

export async function GET(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const r = await db().query<{
    id: string;
    order_id: string;
    status: string;
    reason: string;
    reason_category: string | null;
    requested_at: string;
    reviewed_at: string | null;
    reviewer_note: string | null;
    refunded_halire: number | null;
    event_title: string | null;
  }>(
    `SELECT rr.id, rr.order_id, rr.status, rr.reason, rr.reason_category,
            rr.requested_at, rr.reviewed_at, rr.reviewer_note, rr.refunded_halire,
            e.title AS event_title
     FROM orders.refund_requests rr
     LEFT JOIN orders.orders o ON o.id = rr.order_id
     LEFT JOIN catalog.events e ON e.id = o.event_id
     WHERE rr.user_id = $1
     ORDER BY rr.requested_at DESC
     LIMIT 50`,
    [userId],
  );

  return NextResponse.json({
    items: r.rows.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      status: row.status,
      reason: row.reason,
      reasonCategory: row.reason_category,
      requestedAt: row.requested_at,
      reviewedAt: row.reviewed_at,
      reviewerNote: row.reviewer_note,
      refundedHalire: row.refunded_halire,
      eventTitle: row.event_title,
    })),
  });
}
