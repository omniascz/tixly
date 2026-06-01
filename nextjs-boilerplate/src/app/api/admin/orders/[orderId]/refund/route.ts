/**
 * POST /api/admin/orders/[orderId]/refund
 *
 * Demo refund flow:
 *   1. Ověří, že order patří k promotérově akci (`events.promoter_id`)
 *   2. Ověří, že status === 'paid' (jinak idempotent / 409)
 *   3. V transakci: status → 'refunded', revoke tickety, audit log
 *   4. Vrátí JSON s detailem
 *
 * Pro lokální demo nevoláme reálný GoPay refund — předpokládáme mock.
 * V produkci se před COMMIT zavolá GoPay /payments/{id}/refund.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';
import { escapeHtml } from '@/lib/html-escape/escape';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit/per-tenant';


const REASONS = [
  'event_cancelled',
  'customer_request',
  'duplicate_order',
  'fraud',
  'chargeback',
] as const;

const schema = z.object({
  reason: z.enum(REASONS).default('customer_request'),
  note: z.string().max(500).optional(),
});

interface OrderRow {
  id: string;
  status: string;
  total_amount: number;
  user_id: string;
  event_promoter_id: string;
  event_title: string;
  buyer_email: string;
  buyer_name: string | null;
}

const REASON_LABELS: Record<string, string> = {
  event_cancelled: 'akce byla zrušena',
  customer_request: 'na žádost zákazníka',
  duplicate_order: 'duplicitní objednávka',
  fraud: 'detekováno podezření z podvodu',
  chargeback: 'chargeback z banky',
};

function fmtCzk(halire: number): string {
  return `${(halire / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} Kč`;
}

function buildRefundEmailHtml(input: {
  orderId: string;
  amount: number;
  reason: string;
  eventTitle: string;
  buyerName: string;
}): string {
  const reasonLabel = REASON_LABELS[input.reason] ?? input.reason;
  return `<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111">
  <h1 style="color:#10b981">Refund zpracován</h1>
  <p>Dobrý den ${escapeHtml(input.buyerName)},</p>
  <p>vaše objednávka <strong>${escapeHtml(input.orderId.slice(0, 8))}</strong> byla vrácena.</p>
  <table style="width:100%;border-collapse:collapse;margin-top:24px">
    <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Akce</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(input.eventTitle)}</td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Vrácená částka</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${fmtCzk(input.amount)}</td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Důvod</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(reasonLabel)}</td></tr>
  </table>
  <p style="margin-top:24px;color:#666;font-size:13px">
    Prostředky se na vaší kartě / účtu zobrazí typicky do 3–5 pracovních dnů.
    Vstupenky byly automaticky znehodnoceny.
  </p>
  <p style="margin-top:32px;color:#999;font-size:11px">
    Tixly · vstupenky@tixly.local · Při dotazech odpovězte na tento e-mail.
  </p>
</body></html>`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { orderId: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
  // Refunds: max 60/min per tenant.
  const rl = checkRateLimit(`${promoter.promoterId}:refund`, {
    limit: 60,
    windowMs: 60_000,
  });
  const rlResp = rateLimitResponse(rl, 'refund');
  if (rlResp) return rlResp;

  const orderId = params.orderId;
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
    return NextResponse.json({ error: 'Invalid orderId' }, { status: 422 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    const orderRes = await client.query<OrderRow>(
      `SELECT o.id, o.status, o.total_amount, o.user_id,
              e.promoter_id AS event_promoter_id,
              e.title AS event_title,
              u.email AS buyer_email, u.name AS buyer_name
       FROM orders.orders o
       JOIN catalog.events e ON e.id = o.event_id
       JOIN identity.users u ON u.id = o.user_id
       WHERE o.id = $1
       FOR UPDATE`,
      [orderId],
    );
    if (orderRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    const order = orderRes.rows[0];

    if (order.event_promoter_id !== promoter.promoterId) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Order belongs to another promoter' }, { status: 403 });
    }

    if (order.status === 'refunded') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { ok: true, alreadyRefunded: true, orderId, totalAmount: order.total_amount },
        { status: 200 },
      );
    }

    if (order.status !== 'paid') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: `Order status is "${order.status}", only "paid" can be refunded` },
        { status: 409 },
      );
    }

    // 1) Order → refunded
    await client.query(
      `UPDATE orders.orders SET status = 'refunded', updated_at = NOW() WHERE id = $1`,
      [orderId],
    );

    // 2) Tickets → revoked
    const ticketRes = await client.query<{ count: string }>(
      `WITH revoked AS (
         UPDATE tickets.tickets
         SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
         WHERE order_id = $1 AND status <> 'revoked'
         RETURNING 1
       )
       SELECT COUNT(*)::text AS count FROM revoked`,
      [orderId],
    );
    const revokedCount = Number(ticketRes.rows[0]?.count ?? 0);

    // 3) Restore inventory
    await client.query(
      `UPDATE catalog.ticket_types tt
       SET remaining_qty = remaining_qty + sub.qty
       FROM (
         SELECT ticket_type_id, SUM(quantity) AS qty
         FROM orders.order_items
         WHERE order_id = $1
         GROUP BY ticket_type_id
       ) sub
       WHERE tt.id = sub.ticket_type_id`,
      [orderId],
    );

    // 3b) Uvolnit sedadla — refundované sedadlo se vrátí do prodeje.
    // Vazba: event_seats.order_id (POS / SeatPicker) NEBO order_items.event_seat_id.
    await client.query(
      `UPDATE catalog.event_seats
         SET status = 'available', order_id = NULL, ticket_id = NULL,
             hold_user_id = NULL, hold_until = NULL, updated_at = NOW()
       WHERE order_id = $1
          OR id IN (SELECT event_seat_id FROM orders.order_items
                    WHERE order_id = $1 AND event_seat_id IS NOT NULL)`,
      [orderId],
    );

    // 4) Audit log — action constraint allows only INSERT/UPDATE/DELETE,
    //    refund is logged as UPDATE on orders.orders with new_values.kind='refund'
    await client.query(
      `INSERT INTO audit.audit_log
         (schema_name, table_name, record_id, action, actor_id, actor_type,
          old_values, new_values)
       VALUES ('orders', 'orders', $1, 'UPDATE', $2, 'user',
               $3::jsonb, $4::jsonb)`,
      [
        orderId,
        promoter.userId,
        JSON.stringify({ status: order.status }),
        JSON.stringify({
          kind: 'refund',
          status: 'refunded',
          reason: input.reason,
          note: input.note ?? null,
          amount_halire: order.total_amount,
          revoked_tickets: revokedCount,
        }),
      ],
    );

    await client.query('COMMIT');

    // Fire-and-forget refund notification email — failure NESMÍ vrátit refund
    void (async () => {
      try {
        const { sendMail } = await import('@/lib/email/mailer');
        await sendMail({
          to: order.buyer_email,
          subject: `Tixly — refund objednávky ${orderId.slice(0, 8)}`,
          html: buildRefundEmailHtml({
            orderId,
            amount: order.total_amount,
            reason: input.reason,
            eventTitle: order.event_title,
            buyerName: order.buyer_name ?? order.buyer_email,
          }),
        });
      } catch (err) {
        console.error('[refund] email failed:', err);
      }
    })();

    return NextResponse.json({
      ok: true,
      orderId,
      refundedAmountHalire: order.total_amount,
      revokedTickets: revokedCount,
      reason: input.reason,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /api/admin/orders/[orderId]/refund]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
