/**
 * POST /api/internal/cron/expire-pending-orders
 *
 * Najde orders.status='pending' s expires_at < now() a:
 *   - status → 'expired'
 *   - uvolní held event_seats (status → 'available')
 *   - restore remaining_qty z order_items
 *
 * Spouštět 1× za 5 min (nebo přes Vercel cron 1× minuty).
 * Bezpečnost: x-internal-token.
 */

import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest): Promise<Response> {
  const token = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const client = await db().connect();
  let expiredCount = 0;
  let seatsReleased = 0;
  try {
    await client.query('BEGIN');

    // Najdi expired pending orders
    const expired = await client.query<{ id: string }>(
      `SELECT id FROM orders.orders
       WHERE status = 'pending' AND expires_at < now()
       FOR UPDATE
       LIMIT 500`,
    );
    expiredCount = expired.rows.length;

    if (expiredCount > 0) {
      const orderIds = expired.rows.map((r) => r.id);

      // 1) Update status → expired
      await client.query(
        `UPDATE orders.orders
           SET status = 'expired', updated_at = now()
         WHERE id = ANY($1::uuid[])`,
        [orderIds],
      );

      // 2) Restore remaining_qty
      await client.query(
        `UPDATE catalog.ticket_types tt
           SET remaining_qty = remaining_qty + sub.qty
         FROM (
           SELECT ticket_type_id, SUM(quantity) AS qty
           FROM orders.order_items
           WHERE order_id = ANY($1::uuid[])
           GROUP BY ticket_type_id
         ) sub
         WHERE tt.id = sub.ticket_type_id`,
        [orderIds],
      );

      // 3) Uvolnit event_seats (přes order_id nebo přes order_items.event_seat_id)
      const seatsRes = await client.query(
        `UPDATE catalog.event_seats
           SET status = 'available', order_id = NULL, ticket_id = NULL,
               hold_user_id = NULL, hold_until = NULL, updated_at = now()
         WHERE order_id = ANY($1::uuid[])
            OR id IN (SELECT event_seat_id FROM orders.order_items
                      WHERE order_id = ANY($1::uuid[]) AND event_seat_id IS NOT NULL)`,
        [orderIds],
      );
      seatsReleased = seatsRes.rowCount ?? 0;

      // 4) Audit log per order
      for (const id of orderIds) {
        await client.query(
          `INSERT INTO audit.audit_log
             (schema_name, table_name, record_id, action, actor_type, new_values)
           VALUES ('orders', 'orders', $1, 'UPDATE', 'system', $2::jsonb)`,
          [id, JSON.stringify({ kind: 'expired_by_cron', status: 'expired' })],
        );
      }
    }

    await client.query('COMMIT');
    return NextResponse.json({
      ok: true,
      expiredCount,
      seatsReleased,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[expire-pending-orders]', e);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
