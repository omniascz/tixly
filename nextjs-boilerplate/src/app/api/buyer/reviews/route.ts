/**
 * POST /api/buyer/reviews                — create/upsert review
 * Body: { eventId, rating 1-5, title?, body?, isPublic? }
 *
 * Vyžaduje x-user-id + proof of purchase (user musí mít paid order na daný event).
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const schema = z.object({
  eventId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  title: z.string().max(200).optional(),
  body: z.string().max(2000).optional(),
  isPublic: z.boolean().default(true),
});

export async function POST(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const reqBody = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(reqBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BAD_INPUT', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  // Proof of purchase: find paid order na event
  const order = await db().query<{ id: string; verified: boolean }>(
    `SELECT o.id,
            EXISTS (
              SELECT 1 FROM tickets.tickets t
              WHERE t.order_id = o.id AND t.status = 'used'
            ) AS verified
     FROM orders.orders o
     WHERE o.user_id = $1 AND o.event_id = $2 AND o.status = 'paid'
     ORDER BY o.paid_at ASC
     LIMIT 1`,
    [userId, parsed.data.eventId],
  );
  if (order.rows.length === 0) {
    return NextResponse.json(
      { error: 'NO_PURCHASE', message: 'Recenzi lze přidat jen po nákupu lístku.' },
      { status: 403 },
    );
  }
  const o = order.rows[0]!;

  await db().query(
    `INSERT INTO marketing.event_reviews
       (user_id, event_id, order_id, rating, title, body, is_verified, is_public)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id, event_id)
     DO UPDATE SET rating = $4, title = $5, body = $6, is_public = $8, updated_at = NOW()`,
    [
      userId,
      parsed.data.eventId,
      o.id,
      parsed.data.rating,
      parsed.data.title ?? null,
      parsed.data.body ?? null,
      o.verified,
      parsed.data.isPublic,
    ],
  );

  return NextResponse.json({ ok: true, verified: o.verified });
}
