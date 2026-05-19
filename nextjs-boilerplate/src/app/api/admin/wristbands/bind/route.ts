/**
 * POST /api/admin/wristbands/bind
 *
 * Body: { ticketId, uid, initialTopupHalire? }
 *
 * Promotér naskenuje fyzickou pásku UID a propojí s konkrétním ticketem.
 * Volitelně předá initial top-up (kupec si nabil 500 Kč při check-inu).
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const schema = z.object({
  ticketId: z.string().uuid(),
  uid: z.string().min(4).max(64),
  initialTopupHalire: z.number().int().min(0).max(100_000_000).optional(),
});

interface TicketRow {
  id: string;
  status: string;
  promoter_id: string;
}

export async function POST(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    // Validate ticket ownership přes events.promoter_id
    const t = await client.query<TicketRow>(
      `SELECT t.id, t.status, e.promoter_id
       FROM tickets.tickets t
       JOIN orders.orders o ON o.id = t.order_id
       JOIN catalog.events e ON e.id = o.event_id
       WHERE t.id = $1
       FOR UPDATE`,
      [input.ticketId],
    );
    if (t.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }
    if (t.rows[0].promoter_id !== promoter.promoterId) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Wrong promoter' }, { status: 403 });
    }
    if (t.rows[0].status === 'revoked') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'TICKET_REVOKED' }, { status: 409 });
    }

    // Existing UID conflict?
    const existing = await client.query(
      `SELECT 1 FROM tickets.wristbands WHERE uid = $1`,
      [input.uid],
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'UID_ALREADY_BOUND', message: 'Tato páska je už spárována s jinou vstupenkou.' },
        { status: 409 },
      );
    }

    const initialTopup = input.initialTopupHalire ?? 0;
    await client.query(
      `INSERT INTO tickets.wristbands
         (uid, ticket_id, bound_by_user_id, balance_halire)
       VALUES ($1, $2, $3, $4)`,
      [input.uid, input.ticketId, promoter.userId, initialTopup],
    );
    if (initialTopup > 0) {
      await client.query(
        `INSERT INTO tickets.wristband_transactions
           (wristband_uid, kind, amount_halire, balance_after,
            description, payment_method, performed_by_user_id)
         VALUES ($1, 'topup', $2, $2, 'Initial top-up at bind', 'cash', $3)`,
        [input.uid, initialTopup, promoter.userId],
      );
    }
    await client.query('COMMIT');
    return NextResponse.json({
      ok: true,
      uid: input.uid,
      ticketId: input.ticketId,
      balanceHalire: initialTopup,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /api/admin/wristbands/bind]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
