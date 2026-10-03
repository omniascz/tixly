/**
 * POST /api/v1/wl/orders
 *
 * White-label order creation — partner creates an order on behalf of their customer.
 * Returns a paymentUrl that the partner redirects their customer to.
 *
 * Auth: Bearer wl_live_* or wl_test_*
 *
 * Body:
 * {
 *   eventId:         uuid
 *   tickets: [{
 *     ticketTypeId:  uuid
 *     quantity:      number (1–20)
 *   }]
 *   customerEmail:   string
 *   customerName?:   string
 *   paymentMethod:   'gopay' | 'comgate' | 'stripe' | 'mollie' | 'bank_transfer'
 *   locale?:         'cs' | 'sk' | 'en' | 'de' | 'pl'  (default: 'en')
 *   returnUrl?:      string  — partner's own success page (appended with ?orderId=)
 *   webhookUrl?:     string  — per-order webhook (overrides tenant.callbackUrl)
 * }
 *
 * Response:
 * {
 *   ok:           true
 *   orderId:      uuid
 *   paymentUrl:   string    — redirect customer here
 *   expiresAt:    ISO8601   — order expires if not paid within this time
 *   totalAmount:  number    — minor units
 *   currency:     string
 * }
 *
 * State webhooks sent to tenant.callbackUrl / webhookUrl:
 *   POST { eventType: 'order.paid' | 'order.expired' | 'order.refunded', orderId, ... }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { verifyWlToken, wlResponseHeaders } from '@/lib/whitelabel/tenant-auth';
import { createPayment } from '@/lib/payment/provider';

export const dynamic = 'force-dynamic';

const TicketLineSchema = z.object({
  ticketTypeId: z.string().uuid(),
  quantity:     z.number().int().min(1).max(20),
});

const OrderSchema = z.object({
  eventId:        z.string().uuid(),
  tickets:        z.array(TicketLineSchema).min(1).max(50),
  customerEmail:  z.string().email(),
  customerName:   z.string().max(200).optional(),
  paymentMethod:  z.enum(['gopay', 'wero', 'przelewy24', 'bank_transfer', 'mollie', 'paypal']),
  locale:         z.enum(['cs', 'sk', 'en', 'de', 'pl']).default('en'),
  returnUrl:      z.string().url().optional(),
  webhookUrl:     z.string().url().optional(),
});

interface TicketTypeRow {
  id: string;
  name: string;
  price_halire: number;
  currency: string;
  capacity_remaining: number;
  promoter_id: string;
  event_id: string;
  payment_provider: string | null;
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: wlResponseHeaders() });
}

export async function POST(req: NextRequest): Promise<Response> {
  const tenant = await verifyWlToken(req);
  if (!tenant) {
    return NextResponse.json(
      { error: 'UNAUTHORIZED' },
      { status: 401, headers: wlResponseHeaders() },
    );
  }

  let body: z.infer<typeof OrderSchema>;
  try {
    body = OrderSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'INVALID_INPUT', details: err },
      { status: 400, headers: wlResponseHeaders(tenant) },
    );
  }

  return runWithServiceContext(async () => {
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL statement_timeout = 10000');

      // Resolve ticket types with FOR UPDATE lock
      const ticketTypeIds = body.tickets.map((t) => t.ticketTypeId);
      const ttRes = await client.query<TicketTypeRow>(
        `SELECT tt.id, tt.name, tt.base_price AS price_halire, e.currency,
                tt.remaining_qty AS capacity_remaining, e.promoter_id, e.id AS event_id,
                p.default_payment_provider AS payment_provider
         FROM catalog.ticket_types tt
         JOIN catalog.events e ON e.id = tt.event_id
         JOIN platform.promoters p ON p.id = e.promoter_id
         WHERE tt.id = ANY($1::uuid[])
           AND e.id = $2
           AND tt.status = 'on_sale'
         FOR UPDATE OF tt`,
        [ticketTypeIds, body.eventId],
      );

      if (ttRes.rows.length !== ticketTypeIds.length) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'TICKET_TYPE_NOT_FOUND' },
          { status: 404, headers: wlResponseHeaders(tenant) },
        );
      }

      // Verify tenant is allowed to sell for this promoter
      const promoterId = ttRes.rows[0].promoter_id;
      if (tenant.allowedPromoterIds.length > 0 && !tenant.allowedPromoterIds.includes(promoterId)) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'PROMOTER_NOT_ALLOWED' },
          { status: 403, headers: wlResponseHeaders(tenant) },
        );
      }

      // Check capacity and compute total
      let totalAmount = 0;
      const currency = ttRes.rows[0].currency;
      for (const line of body.tickets) {
        const tt = ttRes.rows.find((r) => r.id === line.ticketTypeId);
        if (!tt) continue;
        if (tt.capacity_remaining < line.quantity) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: 'INSUFFICIENT_CAPACITY', ticketTypeId: line.ticketTypeId },
            { status: 409, headers: wlResponseHeaders(tenant) },
          );
        }
        totalAmount += tt.price_halire * line.quantity;
      }

      // WL service fee
      if (tenant.serviceFeeBps > 0) {
        totalAmount += Math.round((totalAmount * tenant.serviceFeeBps) / 10000);
      }

      const orderId = randomUUID();
      const idempotencyKey = randomUUID();
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';

      // Initiate payment via Tixly provider switcher
      const payment = await createPayment({
        orderId,
        amountHalire: totalAmount,
        currency,
        description: `WL:${tenant.slug} — ${ttRes.rows[0].name}`,
        paymentMethod: body.paymentMethod,
        buyerEmail: body.customerEmail,
        buyerName: body.customerName,
        appUrl,
      });

      // Create order
      await client.query(
        `INSERT INTO orders.orders
           (id, user_id, event_id, status, total_amount, currency, locale,
            gopay_payment_id, payment_provider, idempotency_key,
            expires_at, created_at, updated_at)
         VALUES ($1, NULL, $2, 'pending', $3, $4, $5,
                 $6, $7, $8,
                 NOW() + INTERVAL '30 minutes', NOW(), NOW())`,
        [
          orderId,
          body.eventId,
          totalAmount,
          currency,
          body.locale,
          payment.paymentId,
          payment.provider,
          idempotencyKey,
        ],
      );

      // Decrement capacity
      for (const line of body.tickets) {
        await client.query(
          `UPDATE catalog.ticket_types
           SET remaining_qty = remaining_qty - $2
           WHERE id = $1`,
          [line.ticketTypeId, line.quantity],
        );
        // Create order items
        const tt = ttRes.rows.find((r) => r.id === line.ticketTypeId)!;
        await client.query(
          // `orders.order_items` má `unit_price` / `total_price`, ne `*_halire`
          // (jednotka je haléř tak jako tak). PŘED: 42703 → ROLLBACK → 500 při
          // KAŽDÉ white-label objednávce. Ověřeno reálným během proti klonu.
          // Pozn.: CHECK `total_price = unit_price * quantity` drží, protože
          // hodnota se počítá stejně jako dřív.
          `INSERT INTO orders.order_items
             (order_id, ticket_type_id, quantity, unit_price, total_price)
           VALUES ($1, $2, $3, $4, $5)`,
          [orderId, line.ticketTypeId, line.quantity, tt.price_halire, tt.price_halire * line.quantity],
        );
      }

      // Store WL metadata (webhook URL, tenant ID) in order metadata / payment events
      const callbackUrl = body.webhookUrl ?? tenant.callbackUrl;
      if (callbackUrl) {
        await client.query(
          // `payment_events` má `raw_payload` (NOT NULL), ne `data`.
          // PŘED: 42703 → ROLLBACK → 500. Ověřeno reálným během.
          `INSERT INTO orders.payment_events (order_id, event_type, raw_payload)
           VALUES ($1, 'wl_order_created', $2)
           ON CONFLICT DO NOTHING`,
          [orderId, JSON.stringify({ tenantId: tenant.tenantId, tenantSlug: tenant.slug, callbackUrl, customerEmail: body.customerEmail })],
        );
      }

      await client.query('COMMIT');

      return NextResponse.json(
        {
          ok: true,
          orderId,
          paymentUrl: payment.gatewayUrl,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          totalAmount,
          currency,
        },
        { status: 201, headers: wlResponseHeaders(tenant) },
      );
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[wl/orders] error:', err);
      return NextResponse.json(
        { error: 'INTERNAL', message: err instanceof Error ? err.message : String(err) },
        { status: 500, headers: wlResponseHeaders(tenant) },
      );
    } finally {
      client.release();
    }
  });
}

