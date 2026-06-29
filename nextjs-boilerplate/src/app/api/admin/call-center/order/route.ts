/**
 * POST /api/admin/call-center/order
 *
 * Vytvoří telefonní objednávku (phone order).
 * Generuje HMAC pay-by-link token platný 48 hodin.
 * Promotér zavolá zákazníkovi, zadá údaje, zkopíruje odkaz a pošle SMS/email.
 *
 * Auth: runAsActivePromoter
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithPromoterContext } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { createHmac, randomBytes } from 'crypto';
import { z } from 'zod';

const bodySchema = z.object({
  eventId: z.string().uuid(),
  ticketTypeId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
  customerName: z.string().min(1).max(200),
  customerPhone: z.string().min(1).max(50),
  customerEmail: z.string().email().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

function generatePayLinkToken(orderId: string): string {
  const secret = process.env.INTERNAL_SERVICE_TOKEN ?? 'dev-secret';
  const nonce = randomBytes(8).toString('hex');
  const hmac = createHmac('sha256', secret)
    .update(`${orderId}:${nonce}`)
    .digest('hex');
  return `${nonce}.${hmac}`;
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'VALIDATION_FAILED', issues: parsed.error.issues }, { status: 422 });
    }
    const input = parsed.data;

    return runWithPromoterContext(promoter.promoterId, async () => {
      // Verify event belongs to promoter + get ticket type price
      const ev = await db().query<{ id: string; status: string }>(
        `SELECT id, status FROM catalog.events WHERE id = $1 AND promoter_id = $2 LIMIT 1`,
        [input.eventId, promoter.promoterId],
      );
      if (ev.rows.length === 0) {
        return NextResponse.json({ error: 'EVENT_NOT_FOUND' }, { status: 404 });
      }
      if (ev.rows[0].status === 'cancelled' || ev.rows[0].status === 'ended') {
        return NextResponse.json({ error: 'EVENT_TERMINAL_STATUS' }, { status: 409 });
      }

      const tt = await db().query<{ id: string; base_price: number; remaining_qty: number }>(
        `SELECT id, base_price, remaining_qty FROM catalog.ticket_types WHERE id = $1 AND event_id = $2 LIMIT 1`,
        [input.ticketTypeId, input.eventId],
      );
      if (tt.rows.length === 0) {
        return NextResponse.json({ error: 'TICKET_TYPE_NOT_FOUND' }, { status: 404 });
      }
      if (tt.rows[0].remaining_qty < input.quantity) {
        return NextResponse.json({ error: 'INSUFFICIENT_AVAILABILITY', remaining: tt.rows[0].remaining_qty }, { status: 409 });
      }

      const totalAmount = tt.rows[0].base_price * input.quantity;
      const orderId = crypto.randomUUID();
      const payLinkToken = generatePayLinkToken(orderId);
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

      await db().query(
        `INSERT INTO orders.phone_orders
           (id, promoter_id, event_id, ticket_type_id, quantity, total_amount,
            customer_name, customer_phone, customer_email, notes,
            pay_link_token, pay_link_expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          orderId,
          promoter.promoterId,
          input.eventId,
          input.ticketTypeId,
          input.quantity,
          totalAmount,
          input.customerName,
          input.customerPhone,
          input.customerEmail ?? null,
          input.notes ?? null,
          payLinkToken,
          expiresAt,
          promoter.userId,
        ],
      );

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
      const payLink = `${baseUrl}/cs/checkout/pay-by-link/${orderId}?token=${payLinkToken}`;

      return NextResponse.json({
        phoneOrderId: orderId,
        payLink,
        totalAmount,
        expiresAt,
      }, { status: 201 });
    });
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const url = new URL(req.url);
    const eventId = url.searchParams.get('eventId');
    const limit = Math.min(100, Number(url.searchParams.get('limit') ?? '50'));

    return runWithPromoterContext(promoter.promoterId, async () => {
      const r = await db().query<{
        id: string;
        event_id: string;
        customer_name: string;
        customer_phone: string;
        customer_email: string | null;
        quantity: number;
        total_amount: number;
        status: string;
        pay_link_token: string;
        pay_link_expires_at: string;
        created_at: string;
        event_title: string | null;
        ticket_type_name: string | null;
      }>(
        `SELECT
           po.id,
           po.event_id,
           po.customer_name,
           po.customer_phone,
           po.customer_email,
           po.quantity,
           po.total_amount,
           po.status,
           po.pay_link_token,
           po.pay_link_expires_at,
           po.created_at,
           e.title AS event_title,
           tt.name AS ticket_type_name
         FROM orders.phone_orders po
         LEFT JOIN catalog.events e ON e.id = po.event_id
         LEFT JOIN catalog.ticket_types tt ON tt.id = po.ticket_type_id
         WHERE po.promoter_id = $1
           ${eventId ? 'AND po.event_id = $3' : ''}
         ORDER BY po.created_at DESC
         LIMIT $2`,
        eventId
          ? [promoter.promoterId, limit, eventId]
          : [promoter.promoterId, limit],
      );

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
      return NextResponse.json({
        orders: r.rows.map((row) => ({
          ...row,
          payLink: `${baseUrl}/cs/checkout/pay-by-link/${row.id}?token=${row.pay_link_token}`,
        })),
      });
    });
  });
}
