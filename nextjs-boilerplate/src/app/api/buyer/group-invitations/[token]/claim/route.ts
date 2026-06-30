/**
 * POST /api/buyer/group-invitations/[token]/claim  (AXS Invite — friend claims a seat)
 *
 * Body: { seatId }
 * Přihlášený přítel si vezme jedno z držených sousedních sedadel a dostane
 * mock-gopay platební bránu. Sedadlo se rezervuje na vytvořenou objednávku;
 * pokud nezaplatí do 30 min, cron release-group-invite-holds ho uvolní.
 *
 * Pod /api/buyer/ → middleware injektuje x-user-id (optional-auth), takže
 * runAsUser získá userId. (Dřív pod /api/group-invitations/ = public prefix,
 * kde se x-user-id neinjektuje → 401.)
 */
import { randomUUID } from 'crypto';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const schema = z.object({ seatId: z.string().uuid() });

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
    if (!/^[A-Za-z0-9_-]{20,80}$/.test(params.token)) {
      return NextResponse.json({ error: 'INVALID_TOKEN' }, { status: 400 });
    }
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
    }
    const { seatId } = parsed.data;

    const client = await db().connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.is_platform_admin = 'true'`);

      const invR = await client.query<{
        id: string; event_id: string; ticket_type_id: string | null;
        held_seat_ids: string[]; adjacent_reserve: boolean; status: string;
        hold_expires_at: string | null;
      }>(
        `SELECT id, event_id, ticket_type_id, held_seat_ids, adjacent_reserve, status, hold_expires_at::text
           FROM orders.group_invitations WHERE invite_token = $1 FOR UPDATE`,
        [params.token],
      );
      const inv = invR.rows[0];
      if (!inv || !inv.adjacent_reserve) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'INVITATION_NOT_FOUND' }, { status: 404 });
      }
      if (inv.hold_expires_at && new Date(inv.hold_expires_at).getTime() < Date.now()) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'INVITATION_EXPIRED' }, { status: 410 });
      }
      if (!inv.held_seat_ids.includes(seatId)) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'SEAT_NOT_IN_INVITATION' }, { status: 422 });
      }

      // Sedadlo musí být stále drženo pro tento invite (ne už claimnuté)
      const seatR = await client.query<{ id: string; status: string; hold_kind: string | null; ticket_type_id: string | null }>(
        `SELECT id, status, hold_kind, ticket_type_id FROM catalog.event_seats
          WHERE id = $1 AND event_id = $2 FOR UPDATE`,
        [seatId, inv.event_id],
      );
      const seat = seatR.rows[0];
      if (!seat || seat.status !== 'held' || seat.hold_kind !== 'group_invite') {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'SEAT_ALREADY_CLAIMED' }, { status: 409 });
      }

      const ttId = inv.ticket_type_id ?? seat.ticket_type_id;
      const priceR = await client.query<{ base_price: number; currency: string }>(
        `SELECT tt.base_price, e.currency
           FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id
          WHERE tt.id = $1`,
        [ttId],
      );
      if (!priceR.rows[0]) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'TICKET_TYPE_NOT_FOUND' }, { status: 404 });
      }
      const { base_price: price, currency } = priceR.rows[0];

      // Kupující je linkován přes user_id; orders nemá buyer_email/buyer_name.
      const paymentId = randomUUID();
      const ordR = await client.query<{ id: string }>(
        `INSERT INTO orders.orders
           (user_id, event_id, status, total_amount, currency, gopay_payment_id,
            payment_provider, group_invitation_id, expires_at)
         VALUES ($1, $2, 'pending', $3, $4, $5, 'gopay', $6, NOW() + INTERVAL '30 minutes')
         RETURNING id`,
        [userId, inv.event_id, price, currency, paymentId, inv.id],
      );
      const orderId = ordR.rows[0].id;

      await client.query(
        `INSERT INTO orders.order_items (order_id, ticket_type_id, quantity, unit_price, total_price, seat_id)
         VALUES ($1, $2, 1, $3, $3, $4)`,
        [orderId, ttId, price, seatId],
      );

      // Rezervuj sedadlo na tuto objednávku (sold). Nezaplacené → cron uvolní.
      await client.query(
        `UPDATE catalog.event_seats
            SET status = 'sold', order_id = $2, hold_kind = NULL, hold_until = NULL,
                hold_user_id = NULL, updated_at = NOW()
          WHERE id = $1`,
        [seatId, orderId],
      );

      await client.query(
        `UPDATE orders.group_invitations SET seats_claimed = seats_claimed + 1 WHERE id = $1`,
        [inv.id],
      );
      await client.query('COMMIT');

      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
      return NextResponse.json({
        ok: true,
        orderId,
        gatewayUrl: `${appUrl}/mock-gopay/${paymentId}`,
        amount: price,
        currency,
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error('[POST /api/buyer/group-invitations/[token]/claim]', err);
      return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
