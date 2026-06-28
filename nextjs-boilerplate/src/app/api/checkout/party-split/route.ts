/**
 * POST /api/checkout/party-split
 *
 * Party Pay — skupinová platba za vstupenky.
 *
 * Organizátor zvolí akci, typ vstupenky a počet přátel.
 * Každý platí svůj slot individuálně přes share link.
 * Tixly rezervuje celkovou kapacitu až po zaplacení každého slotu.
 *
 * Výhody oproti "kup vše a rozúčtuj":
 *   - Každý platí sám → organizátor nerisikuje za přátele
 *   - Každý dostane vlastní vstupenku + potvrzení
 *   - Automatický reminder, pokud kamarád nezaplatí 24h před akcí
 *
 * Body:
 * {
 *   eventId:       uuid
 *   ticketTypeId:  uuid
 *   totalSlots:    2–20    (total friends incl. organizer)
 *   organizerName?: string
 *   message?:      string  (shown on share page)
 *   locale?:       'cs'|'sk'|'en'|'de'|'pl'
 * }
 *
 * Response:
 * {
 *   sessionId:  uuid
 *   shareToken: string
 *   shareUrl:   string   — link to send to friends
 *   perPersonAmount: number
 *   currency:   string
 *   expiresAt:  ISO8601
 * }
 *
 * Auth: logged-in user (x-user-id) required for organizer.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

const Schema = z.object({
  eventId:       z.string().uuid(),
  ticketTypeId:  z.string().uuid(),
  totalSlots:    z.number().int().min(2).max(20),
  organizerName: z.string().max(100).optional(),
  message:       z.string().max(500).optional(),
  locale:        z.enum(['cs', 'sk', 'en', 'de', 'pl']).default('cs'),
});

export async function POST(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: 'INVALID_INPUT', details: err }, { status: 400 });
  }

  return runWithServiceContext(async () => {
    // Verify ticket type exists + on sale
    const ttRes = await db().query<{
      price_halire: number;
      currency: string;
      capacity_remaining: number;
      event_title: string;
    }>(
      `SELECT tt.price_halire, tt.currency, tt.capacity_remaining, pr.title AS event_title
       FROM catalog.ticket_types tt
       JOIN catalog.events e ON e.id = tt.event_id
       JOIN catalog.productions pr ON pr.id = e.production_id
       WHERE tt.id = $1 AND e.id = $2 AND tt.status = 'on_sale'`,
      [body.ticketTypeId, body.eventId],
    );

    if (ttRes.rows.length === 0) {
      return NextResponse.json({ error: 'TICKET_TYPE_NOT_FOUND' }, { status: 404 });
    }

    const tt = ttRes.rows[0];
    if (tt.capacity_remaining < body.totalSlots) {
      return NextResponse.json(
        { error: 'INSUFFICIENT_CAPACITY', available: tt.capacity_remaining },
        { status: 409 },
      );
    }

    // Get organizer email
    const userRes = await db().query<{ email: string }>(
      `SELECT email FROM identity.users WHERE id = $1`,
      [userId],
    );
    const organizerEmail = userRes.rows[0]?.email ?? '';

    // Create session
    const sessionRes = await db().query<{
      id: string;
      share_token: string;
      expires_at: string;
    }>(
      `INSERT INTO orders.party_split_sessions
         (event_id, ticket_type_id, organizer_user_id, organizer_email, organizer_name,
          total_slots, per_slot_amount, currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, share_token, expires_at`,
      [
        body.eventId,
        body.ticketTypeId,
        userId,
        organizerEmail,
        body.organizerName ?? null,
        body.totalSlots,
        tt.price_halire,
        tt.currency,
      ],
    );

    const session = sessionRes.rows[0];

    // Create pending slots for all participants
    const slotInserts = Array.from({ length: body.totalSlots }, (_, i) =>
      db().query(
        `INSERT INTO orders.party_split_slots (session_id, slot_index) VALUES ($1, $2)`,
        [session.id, i],
      ),
    );
    await Promise.all(slotInserts);

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
    const shareUrl = `${appUrl}/party/${session.share_token}`;

    return NextResponse.json({
      sessionId:       session.id,
      shareToken:      session.share_token,
      shareUrl,
      perPersonAmount: tt.price_halire,
      currency:        tt.currency,
      totalSlots:      body.totalSlots,
      totalAmount:     tt.price_halire * body.totalSlots,
      expiresAt:       session.expires_at,
      eventTitle:      tt.event_title,
    }, { status: 201 });
  });
}
