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

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

// Server-side Meta CAPI AddToCart pro promotéra dané akce. Volá se fire-and-forget
// z POST holdu; běží ve stejném service kontextu (ALS) jako hold.
async function fireAddToCart(eventId: string, holdToken: string, numItems: number): Promise<void> {
  const { getPromoterTrackingByEvent } = await import('@/lib/tracking/promoter-creds');
  const creds = await getPromoterTrackingByEvent(eventId);
  if (!creds.metaPixelId || !creds.metaCapiToken) return;
  const { sendMetaEvent } = await import('@/lib/tracking/meta-capi');
  await sendMetaEvent(
    {
      eventName: 'AddToCart',
      eventTime: Math.floor(Date.now() / 1000),
      eventId: holdToken,
      pixelId: creds.metaPixelId,
      capiToken: creds.metaCapiToken,
      contentIds: [eventId],
      contentType: 'product',
      numItems,
      sourceUrl: `${BASE_URL}/cs/events/${eventId}`,
    },
    { eventId },
  );
}

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

  // Identita pro "uvolni MŮJ předchozí hold":
  //  - authed buyer → x-user-id (uložené v hold_user_id),
  //  - guest        → stabilní x-fingerprint z prohlížeče (uložené v hold_label).
  // Bez fingerprintu sessionTag = null → úklid přeskočíme. Jinak by sdílený tag
  // ('guest:guest') uvolnil holdy CIZÍCH guestů během souběžného onsale.
  const userId = req.headers.get('x-user-id');
  const fingerprint = req.headers.get('x-fingerprint');
  const sessionTag = userId ?? (fingerprint ? `guest:${fingerprint}` : null);

  return runWithServiceContext(async () => {
    const client = await db().connect();
    try {
      await client.query('BEGIN');

      // Release any prior holds by THIS buyer for this event (clean state).
      // notes = holdToken (checkout proof) zůstává nedotčené; identitu nese
      // hold_user_id (authed) / hold_label (guest).
      if (sessionTag) {
        await client.query(
          `UPDATE catalog.event_seats
           SET status = 'available', hold_user_id = NULL, hold_until = NULL,
               notes = NULL, hold_label = NULL
           WHERE event_id = $1
             AND status = 'held'
             AND hold_kind IS NULL  -- jen dočasné buyer/guest holdy, nikdy admin holdy
             AND (
               hold_user_id::text = $2
               OR (hold_user_id IS NULL AND hold_label = $2)
             )`,
          [params.id, sessionTag],
        );
      }

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
        // Guest: hold_user_id zůstává NULL, identitu drží hold_label = sessionTag
        // (null, pokud guest neposlal fingerprint — pak ho retry-úklid nenajde,
        // sedadla se uvolní až po TTL, ale nikdy neuvolníme cizí guesty).
        await client.query(
          `UPDATE catalog.event_seats
           SET status = 'held', hold_user_id = NULL, hold_until = $2, updated_at = NOW(),
               notes = $3, hold_label = $4
           WHERE id = ANY($1::uuid[])`,
          [parsed.data.seatIds, expiresAt.toISOString(), holdToken, sessionTag],
        );
      }

      await client.query('COMMIT');

      // Meta CAPI AddToCart (server-side, adblock-proof). Fire-and-forget —
      // NIKDY nesmí blokovat ani shodit hold response (kritické při onsale).
      // Dedup key = holdToken → kdyby se časem doplnil i browser pixel
      // AddToCart se stejným eventID, Meta to spáruje a nepočítá 2×.
      void fireAddToCart(params.id, holdToken, parsed.data.seatIds.length).catch((err) =>
        console.error('[seat hold] AddToCart tracking failed:', err),
      );

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
       SET status = 'available', hold_user_id = NULL, hold_until = NULL, notes = NULL, hold_label = NULL
       WHERE event_id = $1 AND notes = $2 AND status = 'held'`,
      [params.id, holdToken],
    );
    return NextResponse.json({ ok: true });
  });
}
