/**
 * POST /api/buyer/group-invitations/[token]/claim  (AXS Invite — friend claims a seat)
 *
 * Body: { seatId }
 * Přihlášený přítel si vezme jedno z držených sousedních sedadel a dostane
 * platební bránu (reálná GoPay/ComGate/Stripe v produkci přes createPayment;
 * mock jen mimo prod). Sedadlo se rezervuje na vytvořenou objednávku;
 * pokud nezaplatí do 30 min, cron release-group-invite-holds ho uvolní.
 *
 * Pod /api/buyer/ → middleware injektuje x-user-id (optional-auth), takže
 * runAsUser získá userId. (Dřív pod /api/group-invitations/ = public prefix,
 * kde se x-user-id neinjektuje → 401.)
 */
import { randomUUID } from 'crypto';
import { asSystemInTx, db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { saleBlockedResponse } from '@/lib/sales/cutoff';

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
      // Kolo 3: pozvánku autorizuje token (není kupcova) → čtení pozvánky, zámek sedadla a založení objednávky jsou systémové příkazy (asSystemInTx); e-mail kupce se čte pod jeho kontextem.

      const invR = await asSystemInTx(client, () => client.query<{
        id: string; event_id: string; ticket_type_id: string | null;
        held_seat_ids: string[]; adjacent_reserve: boolean; status: string;
        hold_expires_at: string | null;
      }>(
        `SELECT id, event_id, ticket_type_id, held_seat_ids, adjacent_reserve, status, hold_expires_at::text
           FROM orders.group_invitations WHERE invite_token = $1 FOR UPDATE`,
        [params.token],
      ));
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
      // Kolo 7 (C-29): převzetí místa ze skupinové rezervace je nákup kupce — po uzávěrce online prodeje ne.
      const salesClosed = await saleBlockedResponse(client, inv.event_id, 'online');
      if (salesClosed) {
        await client.query('ROLLBACK');
        return salesClosed;
      }

      // Sedadlo musí být stále drženo pro tento invite (ne už claimnuté)
      const seatR = await asSystemInTx(client, () => client.query<{ id: string; status: string; hold_kind: string | null; ticket_type_id: string | null }>(
        `SELECT id, status, hold_kind, ticket_type_id FROM catalog.event_seats
          WHERE id = $1 AND event_id = $2 FOR UPDATE`,
        [seatId, inv.event_id],
      ));
      const seat = seatR.rows[0];
      if (!seat || seat.status !== 'held' || seat.hold_kind !== 'group_invite') {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'SEAT_ALREADY_CLAIMED' }, { status: 409 });
      }

      const ttId = inv.ticket_type_id ?? seat.ticket_type_id;
      const priceR = await asSystemInTx(client, () => client.query<{ base_price: number; currency: string; event_title: string }>(
        `SELECT tt.base_price, e.currency, e.title AS event_title
           FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id
          WHERE tt.id = $1`,
        [ttId],
      ));
      if (!priceR.rows[0]) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'TICKET_TYPE_NOT_FOUND' }, { status: 404 });
      }
      const { base_price: price, currency, event_title: eventTitle } = priceR.rows[0];

      // Kupující je linkován přes user_id; orders nemá buyer_email/buyer_name,
      // ale reálná platební brána potřebuje e-mail.
      const userR = await client.query<{ email: string; name: string | null }>(
        `SELECT email, name FROM identity.users WHERE id = $1`,
        [userId],
      );
      const buyer = userR.rows[0];

      // Order s placeholder payment id; reálnou bránu spustíme až po commitu.
      const placeholderPaymentId = randomUUID();
      const ordR = await asSystemInTx(client, () => client.query<{ id: string }>(
        `INSERT INTO orders.orders
           (user_id, event_id, status, total_amount, currency, gopay_payment_id,
            payment_provider, group_invitation_id, expires_at)
         VALUES ($1, $2, 'pending', $3, $4, $5, 'gopay', $6, NOW() + INTERVAL '30 minutes')
         RETURNING id`,
        [userId, inv.event_id, price, currency, placeholderPaymentId, inv.id],
      ));
      const orderId = ordR.rows[0].id;

      await asSystemInTx(client, () => client.query(
        `INSERT INTO orders.order_items (order_id, ticket_type_id, quantity, unit_price, total_price, seat_id)
         VALUES ($1, $2, 1, $3, $3, $4)`,
        [orderId, ttId, price, seatId],
      ));

      // Rezervuj sedadlo na tuto objednávku (sold). Nezaplacené → cron uvolní.
      await asSystemInTx(client, () => client.query(
        `UPDATE catalog.event_seats
            SET status = 'sold', order_id = $2, hold_kind = NULL, hold_until = NULL,
                hold_user_id = NULL, updated_at = NOW()
          WHERE id = $1`,
        [seatId, orderId],
      ));

      await asSystemInTx(client, () => client.query(
        `UPDATE orders.group_invitations SET seats_claimed = seats_claimed + 1 WHERE id = $1`,
        [inv.id],
      ));
      await client.query('COMMIT');

      // Po commitu: reálná platební brána přes stejný switcher jako hlavní
      // checkout (GoPay/ComGate/Stripe v produkci; mock jen mimo prod).
      const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
      try {
        const { createPayment } = await import('@/lib/payment/provider');
        const session = await createPayment({
          orderId,
          amountHalire: price,
          currency,
          buyerEmail: buyer?.email ?? '',
          buyerName: buyer?.name ?? undefined,
          description: `${eventTitle} — sedadlo`,
          paymentMethod: 'gopay',
          appUrl,
        });
        // Jen gopay_payment_id (podle něj brána/webhook najde order). Sloupec
        // payment_provider zůstává 'gopay' z INSERTu — runtime impl ('mock-gopay'
        // ap.) není v orders_payment_provider_check; mirror hlavního checkoutu.
        // Platební id = chráněný sloupec (guard 486) → systémový zápis, ne pod kontextem kupce.
        await client.query('BEGIN');
        await asSystemInTx(client, () => client.query(
          `UPDATE orders.orders SET gopay_payment_id = $2, updated_at = NOW() WHERE id = $1`,
          [orderId, session.paymentId],
        ));
        await client.query('COMMIT');
        return NextResponse.json({
          ok: true,
          orderId,
          gatewayUrl: session.gatewayUrl,
          provider: session.provider,
          amount: price,
          currency,
        });
      } catch (payErr) {
        // Order zůstane pending; cron release-group-invite-holds sedadlo uvolní.
        console.error('[claim payment init]', payErr);
        return NextResponse.json(
          { error: 'PAYMENT_INIT_FAILED', orderId, message: 'Nepodařilo se spustit platební bránu.' },
          { status: 502 },
        );
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error('[POST /api/buyer/group-invitations/[token]/claim]', err);
      return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
