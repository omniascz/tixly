/**
 * POST /api/events/[id]/lotteries/[lotteryId]/enter
 * Body: { email, name?, ticketTypeId, quantity }
 *
 * Buyer se přihlásí do losování. Vyžaduje status='open' a NOW() v okně [opens_at, closes_at].
 * Idempotent per (lottery_id, email).
 *
 * RLS: service kontext — guest (jen email, bez x-user-id) zapisuje lottery entry
 * na cizí event (jako guest write).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

const schema = z.object({
  email: z.string().email().max(200),
  name: z.string().min(1).max(120).optional(),
  ticketTypeId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; lotteryId: string } },
): Promise<Response> {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const userId = req.headers.get('x-user-id');

  return runWithServiceContext(async () => {
    const lottery = await db().query<{
      id: string;
      status: string;
      opens_at: string;
      closes_at: string;
      max_per_entry: number;
    }>(
      `SELECT id, status, opens_at, closes_at, max_per_entry
       FROM catalog.event_lotteries
       WHERE id = $1 AND event_id = $2`,
      [params.lotteryId, params.id],
    );
    if (lottery.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const l = lottery.rows[0];
    const now = Date.now();
    if (l.status !== 'open' || new Date(l.opens_at).getTime() > now || new Date(l.closes_at).getTime() < now) {
      return NextResponse.json(
        { error: 'LOTTERY_CLOSED', status: l.status },
        { status: 409 },
      );
    }
    if (parsed.data.quantity > l.max_per_entry) {
      return NextResponse.json(
        { error: 'EXCEEDS_MAX', maxPerEntry: l.max_per_entry },
        { status: 422 },
      );
    }

    // Validate ticket type belongs to event
    const ttCheck = await db().query(
      `SELECT 1 FROM catalog.ticket_types WHERE id = $1 AND event_id = $2`,
      [parsed.data.ticketTypeId, params.id],
    );
    if (ttCheck.rows.length === 0) {
      return NextResponse.json({ error: 'TICKET_TYPE_NOT_IN_EVENT' }, { status: 422 });
    }

    // Idempotent insert
    const r = await db().query<{ id: string; status: string; created: boolean }>(
      `INSERT INTO catalog.lottery_entries
         (lottery_id, user_id, email, name, ticket_type_id, quantity_requested)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (lottery_id, LOWER(email)) DO UPDATE SET created_at = catalog.lottery_entries.created_at
       RETURNING id, status,
         (xmax = 0) AS created`,
      [
        l.id,
        userId,
        parsed.data.email.toLowerCase(),
        parsed.data.name ?? null,
        parsed.data.ticketTypeId,
        parsed.data.quantity,
      ],
    );

    return NextResponse.json(
      { id: r.rows[0].id, status: r.rows[0].status, created: r.rows[0].created },
      { status: r.rows[0].created ? 201 : 200 },
    );
  });
}
