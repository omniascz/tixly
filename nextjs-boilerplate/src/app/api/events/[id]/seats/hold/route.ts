/**
 * POST /api/events/[id]/seats/hold
 * Body: { seatIds: uuid[] }
 *
 * Atomicky drží sedadla 15 min. Concurrent-safe via FOR UPDATE.
 * Vrátí holdId + expiresAt. Buyer ho pak posílá při checkoutu jako proof.
 *
 * Limit: 10 sedadel per request, 1 hold per buyer (release any prior).
 *
 * RLS: service kontext — drží/uvolňuje seat inventory pro auth i guest buyery
 * (trusted server op, jako checkout). connect() injektuje app.role z ALS.
 */

import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

const HOLD_TTL_MIN = 15;
const MAX_SEATS = 10;

const schema = z.object({
  seatIds: z.array(z.string().uuid()).min(1).max(MAX_SEATS),
});

// CORS preflight pro cross-origin embed seat-picker (hold). Hlavičky doplní next.config.
export function OPTIONS(): Response {
  return new Response(null, { status: 204 });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  // Distinguish buyer: prefer x-user-id, fallback na hold token cookie
  const userId = req.headers.get('x-user-id');
  // Pro guest checkout: vygenerujeme deterministic hold-pseudo-id z fingerprint
  // Tady jen pseudo-userId fallback — server tag, no auth claim
  const fingerprint = req.headers.get('x-fingerprint') ?? 'guest';
  const sessionTag = userId ?? `guest:${fingerprint}`;

  return runWithServiceContext(async () => {
    const client = await db().connect();
    try {
      await client.query('BEGIN');

      // Release any prior holds by this buyer for this event (clean state)
      await client.query(
        `UPDATE catalog.event_seats
         SET status = 'available', hold_user_id = NULL, hold_until = NULL
         WHERE event_id = $1
           AND status = 'held'
           AND (
             hold_user_id::text = $2
             OR (hold_user_id IS NULL AND notes = $2)
           )`,
        [params.id, sessionTag],
      );

      // Lock + verify all requested seats are available (or already this buyer's hold)
      const seats = await client.query<{ id: string; status: string; hold_until: string | null }>(
        `SELECT id, status, hold_until
         FROM catalog.event_seats
         WHERE id = ANY($1::uuid[]) AND event_id = $2
         FOR UPDATE`,
        [parsed.data.seatIds, params.id],
      );

      if (seats.rows.length !== parsed.data.seatIds.length) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'SEAT_NOT_FOUND' },
          { status: 404 },
        );
      }

      const now = Date.now();
      const unavailable = seats.rows.filter(
        (s) => s.status !== 'available' && !(s.status === 'held' && s.hold_until && new Date(s.hold_until).getTime() < now),
      );
      if (unavailable.length > 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'SEAT_UNAVAILABLE',
            unavailableIds: unavailable.map((s) => s.id),
          },
          { status: 409 },
        );
      }

      const holdToken = randomUUID();
      const expiresAt = new Date(Date.now() + HOLD_TTL_MIN * 60 * 1000);

      // For authenticated user: hold_user_id = real user. For guest: keep null but tag in notes.
      if (userId) {
        await client.query(
          `UPDATE catalog.event_seats
           SET status = 'held', hold_user_id = $2::uuid, hold_until = $3, updated_at = NOW(),
               notes = $4
           WHERE id = ANY($1::uuid[])`,
          [parsed.data.seatIds, userId, expiresAt.toISOString(), holdToken],
        );
      } else {
        await client.query(
          `UPDATE catalog.event_seats
           SET status = 'held', hold_user_id = NULL, hold_until = $2, updated_at = NOW(),
               notes = $3
           WHERE id = ANY($1::uuid[])`,
          [parsed.data.seatIds, expiresAt.toISOString(), holdToken],
        );
      }

      await client.query('COMMIT');
      return NextResponse.json({
        holdToken,
        seatIds: parsed.data.seatIds,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[seat hold]', err);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { holdToken?: string };
  const holdToken = body.holdToken;
  if (!holdToken || !/^[0-9a-f-]{36}$/i.test(holdToken)) {
    return NextResponse.json({ error: 'Invalid hold token' }, { status: 422 });
  }
  return runWithServiceContext(async () => {
    await db().query(
      `UPDATE catalog.event_seats
       SET status = 'available', hold_user_id = NULL, hold_until = NULL, notes = NULL
       WHERE event_id = $1 AND notes = $2 AND status = 'held'`,
      [params.id, holdToken],
    );
    return NextResponse.json({ ok: true });
  });
}
