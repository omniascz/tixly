/**
 * POST /api/partner/sales
 *
 * Partner POS sale endpoint. Vytvoří order status='paid' + comp ticket flow
 * (vystavení vstupenek přes existující issuer). Provize partnera se zapíše
 * do partner_sales pro pozdější settlement.
 *
 * Auth: Authorization: Bearer tixly_partner_xxx
 *
 * Body: {
 *   eventId, ticketTypeId, quantity,
 *   buyerEmail?, buyerName?, buyerPhone?,
 *   paymentMethod: 'cash' | 'card_terminal'
 * }
 */

import { randomUUID } from 'crypto';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePartner } from '@/lib/partner/auth';
import { saleBlockedResponse } from '@/lib/sales/cutoff';


const schema = z.object({
  eventId: z.string().uuid(),
  ticketTypeId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
  buyerEmail: z.string().email().max(320).optional(),
  buyerName: z.string().min(1).max(120).optional(),
  buyerPhone: z.string().min(8).max(20).optional(),
  paymentMethod: z.enum(['cash', 'card_terminal']),
});

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  const partner = await requirePartner(req);
  if (!partner) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (partner.status !== 'active') {
    return NextResponse.json({ error: 'PARTNER_NOT_ACTIVE', status: partner.status }, { status: 403 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BAD_INPUT', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  // Kolo 7 (C-29): partner prodává na místě/offline — do konce akce, jako pokladna.
  const salesClosed = await saleBlockedResponse(db(), parsed.data.eventId, 'box_office');
  if (salesClosed) return salesClosed;

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    // Lock ticket type + ověř kapacitu
    const tt = await client.query<{
      id: string;
      base_price: number;
      remaining_qty: number;
      currency: string;
      requires_personalization: boolean;
    }>(
      `SELECT tt.id, tt.base_price, tt.remaining_qty, e.currency,
              COALESCE(tt.requires_personalization, FALSE) AS requires_personalization
       FROM catalog.ticket_types tt
       JOIN catalog.events e ON e.id = tt.event_id
       WHERE tt.id = $1 AND tt.event_id = $2 AND e.status = 'published'
       FOR UPDATE`,
      [parsed.data.ticketTypeId, parsed.data.eventId],
    );
    if (tt.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'TICKET_TYPE_NOT_FOUND' }, { status: 404 });
    }
    const t = tt.rows[0];
    if (t.remaining_qty < parsed.data.quantity) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'INSUFFICIENT_INVENTORY', remaining: t.remaining_qty },
        { status: 409 },
      );
    }

    // Anonymní buyer user (partner+xxx@<partner-id>.partner.local)
    const buyerEmail =
      parsed.data.buyerEmail ?? `partner-${randomUUID().slice(0, 8)}@${partner.partnerId.slice(0, 8)}.partner.local`;
    const buyerName = parsed.data.buyerName ?? `Partner POS — ${partner.partnerName}`;

    const userRes = await client.query<{ id: string }>(
      `INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at)
       VALUES (LOWER($1), $2, '!guest', NOW())
       ON CONFLICT (email) WHERE anonymized_at IS NULL DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [buyerEmail, buyerName],
    );
    const userId = userRes.rows[0].id;

    const totalAmount = t.base_price * parsed.data.quantity;
    const orderId = randomUUID();

    await client.query(
      `INSERT INTO orders.orders
         (id, user_id, event_id, status, total_amount, currency, locale,
          gopay_payment_id, payment_provider, idempotency_key,
          discount_halire, requires_age_verification, paid_at, expires_at,
          created_at, updated_at)
       VALUES ($1, $2, $3, 'paid', $4, $5, 'cs',
               $6, 'partner_pos', $7,
               0, FALSE, NOW(), NOW() + INTERVAL '1 day',
               NOW(), NOW())`,
      [
        orderId,
        userId,
        parsed.data.eventId,
        totalAmount,
        t.currency,
        `partner-${partner.partnerId.slice(0, 8)}-${parsed.data.paymentMethod}`,
        randomUUID(),
      ],
    );
    await client.query(
      `INSERT INTO orders.order_items
         (order_id, ticket_type_id, quantity, unit_price, total_price)
       VALUES ($1, $2, $3, $4, $5)`,
      [orderId, t.id, parsed.data.quantity, t.base_price, totalAmount],
    );

    // Decrement inventory
    await client.query(
      `UPDATE catalog.ticket_types
       SET remaining_qty = remaining_qty - $2
       WHERE id = $1`,
      [t.id, parsed.data.quantity],
    );

    // Track partner sale + commission
    const commissionHalire = Math.floor((totalAmount * partner.commissionPct) / 100);
    await client.query(
      `INSERT INTO partner.partner_sales
         (partner_id, token_id, order_id, gross_halire, partner_commission_halire)
       VALUES ($1, $2, $3, $4, $5)`,
      [partner.partnerId, partner.tokenId, orderId, totalAmount, commissionHalire],
    );

    await client.query('COMMIT');

    // Fire-and-forget issuance (existing pattern z POS)
    void (async () => {
      try {
        const { issueTicketsForOrder } = await import('@/lib/tickets/demo-issuer');
        await issueTicketsForOrder(orderId, db());
      } catch (err) {
        console.error('[partner sale] ticket issuance failed:', err);
      }
    })();

    return NextResponse.json({
      ok: true,
      orderId,
      totalHalire: totalAmount,
      commissionHalire,
      paymentMethod: parsed.data.paymentMethod,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[partner sales]', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
