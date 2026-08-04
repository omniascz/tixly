/**
 * GET  /api/checkout/party-split/{token} — session status (public)
 * POST /api/checkout/party-split/{token} — claim + pay a slot
 *
 * GET response:
 * {
 *   sessionId, eventTitle, venueCity, dateStart,
 *   perSlotAmount, currency, totalSlots, paidSlots, pendingSlots,
 *   status: 'open' | 'complete' | 'expired',
 *   expiresAt,
 *   slots: [{ index, status: 'paid'|'pending'|'reserved', payerName? }]
 * }
 *
 * POST body (claims one pending slot):
 * {
 *   payerEmail:  string
 *   payerName?:  string
 *   paymentMethod: 'gopay' | 'stripe' | 'mollie' | 'comgate' | ...
 *   locale?:     string
 * }
 * → redirectUrl (payment gateway)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { createPayment } from '@/lib/payment/provider';

export const dynamic = 'force-dynamic';

interface SessionRow {
  id: string;
  event_id: string;
  ticket_type_id: string;
  per_slot_amount: number;
  currency: string;
  total_slots: number;
  status: string;
  expires_at: string;
  event_title: string;
  venue_city: string | null;
  date_start: string;
}

interface SlotRow {
  slot_index: number;
  payer_name: string | null;
  status: string;
}

async function getSession(token: string): Promise<{ session: SessionRow; slots: SlotRow[] } | null> {
  const res = await db().query<SessionRow>(
    `SELECT ps.id, ps.event_id, ps.ticket_type_id, ps.per_slot_amount, ps.currency,
            ps.total_slots, ps.status, ps.expires_at,
            pr.title AS event_title,
            v.city AS venue_city,
            e.date_start
     FROM orders.party_split_sessions ps
     JOIN catalog.events e ON e.id = ps.event_id
     JOIN catalog.productions pr ON pr.id = e.production_id
     LEFT JOIN catalog.venues v ON v.id = e.venue_id
     WHERE ps.share_token = $1`,
    [token],
  );
  if (res.rows.length === 0) return null;

  const slots = await db().query<SlotRow>(
    `SELECT slot_index, payer_name, status FROM orders.party_split_slots
     WHERE session_id = $1 ORDER BY slot_index`,
    [res.rows[0].id],
  );

  return { session: res.rows[0], slots: slots.rows };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } },
): Promise<Response> {
  return runWithServiceContext(async () => {
    const data = await getSession(params.token);
    if (!data) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    const { session, slots } = data;
    const paidSlots = slots.filter((s) => s.status === 'paid').length;

    // Auto-expire check
    if (session.status === 'open' && new Date(session.expires_at) < new Date()) {
      await db().query(
        `UPDATE orders.party_split_sessions SET status = 'expired' WHERE id = $1`,
        [session.id],
      );
    }

    return NextResponse.json({
      sessionId:    session.id,
      eventTitle:   session.event_title,
      venueCity:    session.venue_city,
      dateStart:    session.date_start,
      perSlotAmount: session.per_slot_amount,
      currency:     session.currency,
      totalSlots:   session.total_slots,
      paidSlots,
      pendingSlots: session.total_slots - paidSlots,
      status:       session.status,
      expiresAt:    session.expires_at,
      slots: slots.map((s) => ({
        index:      s.slot_index,
        status:     s.status,
        payerName:  s.payer_name,
      })),
    });
  });
}

const PaySchema = z.object({
  payerEmail:    z.string().email(),
  payerName:     z.string().max(100).optional(),
  paymentMethod: z.enum(['gopay', 'wero', 'przelewy24', 'bank_transfer', 'mollie', 'paypal']),
  locale:        z.enum(['cs', 'sk', 'en', 'de', 'pl']).default('cs'),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } },
): Promise<Response> {
  let body: z.infer<typeof PaySchema>;
  try {
    body = PaySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: 'INVALID_INPUT', details: err }, { status: 400 });
  }

  return runWithServiceContext(async () => {
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL statement_timeout = 8000');

      // Lock session
      const sessRes = await client.query<SessionRow>(
        `SELECT ps.id, ps.event_id, ps.ticket_type_id, ps.per_slot_amount, ps.currency,
                ps.total_slots, ps.status, ps.expires_at,
                pr.title AS event_title, e.date_start, v.city AS venue_city
         FROM orders.party_split_sessions ps
         JOIN catalog.events e ON e.id = ps.event_id
         JOIN catalog.productions pr ON pr.id = e.production_id
         LEFT JOIN catalog.venues v ON v.id = e.venue_id
         WHERE ps.share_token = $1
         FOR UPDATE OF ps`,
        [params.token],
      );

      if (sessRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
      }

      const session = sessRes.rows[0];
      if (session.status !== 'open' || new Date(session.expires_at) < new Date()) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'SESSION_CLOSED', status: session.status }, { status: 409 });
      }

      // Claim a pending slot (FOR UPDATE)
      const slotRes = await client.query<{ id: string; slot_index: number }>(
        `SELECT id, slot_index FROM orders.party_split_slots
         WHERE session_id = $1 AND status = 'pending'
         ORDER BY slot_index ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [session.id],
      );

      if (slotRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'NO_SLOTS_AVAILABLE' }, { status: 409 });
      }

      const slot = slotRes.rows[0];

      // Mark slot as reserved (prevents race condition)
      await client.query(
        `UPDATE orders.party_split_slots
         SET status = 'reserved', payer_email = $2, payer_name = $3, reserved_at = NOW()
         WHERE id = $1`,
        [slot.id, body.payerEmail, body.payerName ?? null],
      );

      // Create pending order for this slot
      const orderId = randomUUID();
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';

      const payment = await createPayment({
        orderId,
        amountHalire: session.per_slot_amount,
        currency: session.currency,
        description: `${session.event_title} — slot ${slot.slot_index + 1}/${session.total_slots}`,
        paymentMethod: body.paymentMethod,
        buyerEmail: body.payerEmail,
        buyerName: body.payerName,
        appUrl,
      });

      await client.query(
        `INSERT INTO orders.orders
           (id, event_id, status, total_amount, currency, locale,
            gopay_payment_id, payment_provider, idempotency_key,
            expires_at, created_at, updated_at)
         VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8,
                 NOW() + INTERVAL '30 minutes', NOW(), NOW())`,
        [
          orderId,
          session.event_id,
          session.per_slot_amount,
          session.currency,
          body.locale,
          payment.paymentId,
          payment.provider,
          randomUUID(),
        ],
      );

      // Link order to slot + decrement capacity
      await client.query(
        `UPDATE orders.party_split_slots SET order_id = $2 WHERE id = $1`,
        [slot.id, orderId],
      );

      // Sloupec se jmenuje `remaining_qty` — `capacity_remaining` v DB
      // NEEXISTUJE (rename probehl v DB, ne v kodu; FINDINGS 61), takze tenhle
      // dekrement inventare dosud koncil na 42703.
      // ⚠️ Bez `WHERE remaining_qty > 0`: proti zapornemu stavu chrani CHECK
      // `ticket_types_remaining_qty_check (remaining_qty >= 0)`, takze prekroceni
      // da 23514 a transakce se vrati — fail-closed, ne oversell. Doplneni
      // explicitni pojistky je samostatna zmena (FINDINGS 63).
      await client.query(
        `UPDATE catalog.ticket_types
         SET remaining_qty = remaining_qty - 1, updated_at = NOW()
         WHERE id = $1`,
        [session.ticket_type_id],
      );

      await client.query('COMMIT');

      return NextResponse.json({
        ok: true,
        orderId,
        redirectUrl: payment.gatewayUrl,
        slotIndex: slot.slot_index,
        amount: session.per_slot_amount,
        currency: session.currency,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'INTERNAL', message: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    } finally {
      client.release();
    }
  });
}
