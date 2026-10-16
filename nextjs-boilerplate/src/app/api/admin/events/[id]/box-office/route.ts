/**
 * GET  /api/admin/events/[id]/box-office — aktivní session + ticket types pro POS
 * POST /api/admin/events/[id]/box-office — otevřít novou pokladní session
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsPromoter(req, async (ctx) => {
    const client = await db().connect();
    try {
      const own = await client.query(
        `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
        [params.id, ctx.promoterId],
      );
      if (own.rowCount === 0) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

      const [sessionRes, typesRes, eventRes] = await Promise.all([
        client.query(
          `SELECT s.*, u.name AS cashier_name
             FROM orders.box_office_sessions s
             JOIN identity.users u ON u.id = s.cashier_user_id
            WHERE s.event_id = $1 AND s.status = 'open'
            ORDER BY s.opened_at DESC LIMIT 1`,
          [params.id],
        ),
        client.query(
          `SELECT id, name, base_price AS price_halire, remaining_qty,
                  (SELECT currency FROM catalog.events WHERE id = $1) AS currency
             FROM catalog.ticket_types
            WHERE event_id = $1 AND remaining_qty > 0
            ORDER BY base_price`,
          [params.id],
        ),
        client.query(
          `SELECT title, date_start FROM catalog.events WHERE id = $1`,
          [params.id],
        ),
      ]);

      return NextResponse.json({
        event: eventRes.rows[0] ?? null,
        activeSession: sessionRes.rows[0] ?? null,
        ticketTypes: typesRes.rows,
      });
    } finally {
      client.release();
    }
  });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsPromoter(req, async (ctx) => {
    let body: { openingCashHalire?: number };
    try { body = (await req.json()) as typeof body; } catch { body = {}; }

    const client = await db().connect();
    try {
      const own = await client.query(
        `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
        [params.id, ctx.promoterId],
      );
      if (own.rowCount === 0) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

      // Close any existing open session first
      await client.query(
        `UPDATE orders.box_office_sessions SET status='closed', closed_at=now()
          WHERE event_id=$1 AND status='open'`,
        [params.id],
      );

      const r = await client.query<{ id: string }>(
        `INSERT INTO orders.box_office_sessions
           (event_id, cashier_user_id, opening_cash_halire)
         VALUES ($1, $2, $3) RETURNING id`,
        [params.id, ctx.userId, body.openingCashHalire ?? 0],
      );

      return NextResponse.json({ sessionId: r.rows[0].id }, { status: 201 });
    } finally {
      client.release();
    }
  });
}
