/**
 * POST /api/admin/wristbands/[uid]/topup
 * Body: { amountHalire, paymentMethod ('cash'|'card'|'gopay'), description? }
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';


const schema = z.object({
  amountHalire: z.number().int().min(100).max(100_000_000),
  paymentMethod: z.enum(['cash', 'card', 'gopay']),
  description: z.string().max(200).optional(),
});

export async function POST(req: NextRequest, props: { params: Promise<{ uid: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => ({}));
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
    const w = await client.query<{
      uid: string;
      balance_halire: number;
      active: boolean;
      promoter_id: string;
    }>(
      `SELECT w.uid, w.balance_halire, w.active, e.promoter_id
       FROM tickets.wristbands w
       JOIN tickets.tickets t ON t.id = w.ticket_id
       JOIN orders.orders o ON o.id = t.order_id
       JOIN catalog.events e ON e.id = o.event_id
       WHERE w.uid = $1 FOR UPDATE`,
      [params.uid],
    );
    if (w.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Wristband not found' }, { status: 404 });
    }
    if (w.rows[0].promoter_id !== promoter.promoterId) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Wrong promoter' }, { status: 403 });
    }
    if (!w.rows[0].active) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'WRISTBAND_BLOCKED' }, { status: 409 });
    }

    const newBalance = w.rows[0].balance_halire + input.amountHalire;
    await client.query(
      `UPDATE tickets.wristbands SET balance_halire = $1 WHERE uid = $2`,
      [newBalance, params.uid],
    );
    await client.query(
      `INSERT INTO tickets.wristband_transactions
         (wristband_uid, kind, amount_halire, balance_after,
          description, payment_method, performed_by_user_id)
       VALUES ($1, 'topup', $2, $3, $4, $5, $6)`,
      [
        params.uid,
        input.amountHalire,
        newBalance,
        input.description ?? 'Top-up',
        input.paymentMethod,
        promoter.userId,
      ],
    );
    await client.query('COMMIT');
    return NextResponse.json({ ok: true, balanceHalire: newBalance });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[topup]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
