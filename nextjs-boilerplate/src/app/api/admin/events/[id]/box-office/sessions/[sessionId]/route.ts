/**
 * GET    /api/admin/events/[id]/box-office/sessions/[sessionId] — session detail + sales
 * DELETE /api/admin/events/[id]/box-office/sessions/[sessionId] — close session
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; sessionId: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const client = await db().connect();
    try {
      const own = await client.query(
        `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
        [params.id, ctx.promoterId],
      );
      if (own.rowCount === 0) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

      const [sessionRes, salesRes] = await Promise.all([
        client.query(
          `SELECT s.*, u.name AS cashier_name
             FROM orders.box_office_sessions s JOIN identity.users u ON u.id = s.cashier_user_id
            WHERE s.id = $1 AND s.event_id = $2`,
          [params.sessionId, params.id],
        ),
        client.query(
          `SELECT * FROM orders.box_office_sales WHERE session_id = $1 ORDER BY created_at DESC`,
          [params.sessionId],
        ),
      ]);

      if (sessionRes.rowCount === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
      return NextResponse.json({ session: sessionRes.rows[0], sales: salesRes.rows });
    } finally {
      client.release();
    }
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; sessionId: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const client = await db().connect();
    try {
      const own = await client.query(
        `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
        [params.id, ctx.promoterId],
      );
      if (own.rowCount === 0) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

      await client.query(
        `UPDATE orders.box_office_sessions
            SET status = 'closed', closed_at = now()
          WHERE id = $1 AND event_id = $2 AND status = 'open'`,
        [params.sessionId, params.id],
      );

      return NextResponse.json({ closed: params.sessionId });
    } finally {
      client.release();
    }
  });
}
