/**
 * POST /api/mobile/payment-intent
 * Vytvoří Stripe PaymentIntent pro nativní platební sheet v mobilní appce.
 * Zadrží inventář, vytvoří pending objednávku a vrátí clientSecret.
 *
 * Auth: Bearer JWT (x-user-id z middleware)
 * 503 pokud STRIPE_SECRET_KEY není nakonfigurován → mobile přepne na WebView.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runAsUser } from '@/lib/auth';
import { asSystemInTx, db } from '@/lib/db/rls-pool';
import { z } from 'zod';
import { enforceOrderCreationLimits } from '@/lib/orders/order-creation-limits';

export const dynamic = 'force-dynamic';

const schema = z.object({
  eventId:      z.string().uuid(),
  ticketTypeId: z.string().uuid(),
  qty:          z.number().int().min(1).max(10),
});

async function stripePost<T>(
  path: string,
  params: Record<string, string>,
  idempotencyKey: string,
): Promise<T> {
  const secret = process.env.STRIPE_SECRET_KEY!;
  // Kolo 3: základ API konfigurovatelný jako ve stripe/webhook (testy míří na simulátor).
  const base = process.env.STRIPE_API_BASE_URL ?? 'https://api.stripe.com';
  const res = await fetch(`${base}/v1${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': idempotencyKey,
    },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    const err = (await res.json()) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Stripe ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'STRIPE_NOT_CONFIGURED' }, { status: 503 });
  }

  return runAsUser(req, async (userId) => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
    }
    const { eventId, ticketTypeId, qty } = parsed.data;

    // Kolo 3: stejné limity vytváření objednávek jako web checkout (K3), sdílený mechanismus
    // i sdílený IP klíč — route zadrží inventář a založí pending objednávku stejně jako checkout.
    const limited = await enforceOrderCreationLimits(req, { userId });
    if (limited) return limited;

    const client = await db().connect();
    try {
      await client.query('BEGIN');

      // Uzamkneme ticket_type a zkontrolujeme dostupnost.
      // Kolo 2 / V8: zámek/snížení kapacity a vznik objednávky jsou systémové operace
      // (jako checkout v servisním kontextu) — kupec je pod RLS sám provést nesmí.
      const ttRes = await asSystemInTx(client, () => client.query<{
        id: string; base_price: number; currency: string; remaining_qty: number;
      }>(
        `SELECT tt.id, tt.base_price, e.currency, tt.remaining_qty
         FROM catalog.ticket_types tt
         JOIN catalog.events e ON e.id = tt.event_id
         WHERE tt.id = $1 AND tt.event_id = $2 AND e.status = 'published'
         FOR UPDATE OF tt`,
        [ticketTypeId, eventId],
      ));
      if (!ttRes.rows[0]) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
      }
      const tt = ttRes.rows[0];
      if (tt.remaining_qty < qty) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'SOLD_OUT', remaining: tt.remaining_qty }, { status: 409 });
      }

      const totalAmount = tt.base_price * qty;

      // Snížení inventáře
      await asSystemInTx(client, () => client.query(
        `UPDATE catalog.ticket_types SET remaining_qty = remaining_qty - $1 WHERE id = $2`,
        [qty, ticketTypeId],
      ));

      // Vytvoření pending objednávky (expires za 30 min — cron vrátí inventář)
      const orderRes = await asSystemInTx(client, () => client.query<{ id: string }>(
        `INSERT INTO orders.orders
           (user_id, event_id, status, total_amount, currency, payment_provider, expires_at)
         VALUES ($1, $2, 'pending', $3, $4, 'stripe', NOW() + INTERVAL '30 minutes')
         RETURNING id`,
        [userId, eventId, totalAmount, tt.currency],
      ));
      const orderId = orderRes.rows[0].id;

      await asSystemInTx(client, () => client.query(
        `INSERT INTO orders.order_items (order_id, ticket_type_id, quantity, unit_price, total_price)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, ticketTypeId, qty, tt.base_price, totalAmount],
      ));

      // Stripe PaymentIntent — bez redirect-based metod (nativní sheet)
      const pi = await stripePost<{ id: string; client_secret: string }>(
        '/payment_intents',
        {
          'amount': String(totalAmount),
          'currency': tt.currency.toLowerCase(),
          'automatic_payment_methods[enabled]': 'true',
          'automatic_payment_methods[allow_redirects]': 'never',
          'metadata[orderId]': orderId,
          'metadata[userId]': userId,
        },
        orderId,
      );

      // Uložit PI id do gopay_payment_id (sdílené pole pro payment reference)
      // Kolo 3 (guard 486): platební identifikátor = chráněný sloupec; zapisuje ho systém
      // (PI právě založený naším serverem pro tuto objednávku), ne kupec.
      await asSystemInTx(client, () => client.query(
        `UPDATE orders.orders SET gopay_payment_id = $1 WHERE id = $2`,
        [pi.id, orderId],
      ));

      await client.query('COMMIT');

      return NextResponse.json({
        clientSecret:     pi.client_secret,
        paymentIntentId:  pi.id,
        orderId,
        amount:           totalAmount,
        currency:         tt.currency,
        publishableKey:   process.env.STRIPE_PUBLISHABLE_KEY ?? '',
      });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[mobile/payment-intent]', e);
      return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
