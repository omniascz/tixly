/**
 * POST /api/admin/reservations
 *
 * B2B / phone reservation — promotér box office staff vytvoří order pro buyer
 * (typicky po telefonickém kontaktu nebo email request). Order = pending,
 * expires_at = nastavený (default 7 dní), payment_method = 'reservation'.
 *
 * Po zaplacení (bank transfer → reconcile) order přejde na 'paid' a vystaví
 * vstupenky stejně jako u běžného online prodeje.
 *
 * Body: {
 *   eventId, ticketTypeId, quantity,
 *   buyerEmail, buyerName, buyerPhone?, companyName?, companyVatId?,
 *   reservationExpiryDays?, paymentMethod?, internalNote?
 * }
 *
 * Vrací orderId, variabilní symbol, expires_at.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const schema = z.object({
  eventId: z.string().uuid(),
  ticketTypeId: z.string().uuid(),
  quantity: z.number().int().min(1).max(100),
  buyerEmail: z.string().email().max(320),
  buyerName: z.string().min(1).max(120),
  buyerPhone: z.string().max(20).optional(),
  companyName: z.string().max(200).optional(),
  companyVatId: z.string().max(50).optional(),
  reservationExpiryDays: z.number().int().min(1).max(30).default(7),
  paymentMethod: z.enum(['bank_transfer', 'invoice']).default('bank_transfer'),
  internalNote: z.string().max(1000).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BAD_INPUT', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    // Ownership check + ticket type lock
    const tt = await client.query<{
      id: string;
      base_price: number;
      remaining_qty: number;
      currency: string;
    }>(
      `SELECT tt.id, tt.base_price, tt.remaining_qty, e.currency
       FROM catalog.ticket_types tt
       JOIN catalog.events e ON e.id = tt.event_id
       WHERE tt.id = $1 AND tt.event_id = $2 AND e.promoter_id = $3
       FOR UPDATE`,
      [parsed.data.ticketTypeId, parsed.data.eventId, promoter.promoterId],
    );
    if (tt.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'TICKET_TYPE_NOT_FOUND' }, { status: 404 });
    }
    const t = tt.rows[0]!;
    if (t.remaining_qty < parsed.data.quantity) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'INSUFFICIENT_INVENTORY', remaining: t.remaining_qty },
        { status: 409 },
      );
    }

    // Create/upsert buyer user
    const userRes = await client.query<{ id: string }>(
      `INSERT INTO identity.users (email, name, phone, password_hash, status)
       VALUES (LOWER($1), $2, $3, '', 'active')
       ON CONFLICT (email) DO UPDATE
         SET name = COALESCE(EXCLUDED.name, identity.users.name),
             phone = COALESCE(EXCLUDED.phone, identity.users.phone),
             updated_at = NOW()
       RETURNING id`,
      [
        parsed.data.buyerEmail,
        parsed.data.buyerName,
        parsed.data.buyerPhone ?? null,
      ],
    );
    const userId = userRes.rows[0]!.id;

    const totalAmount = t.base_price * parsed.data.quantity;
    const orderId = randomUUID();
    const variableSymbol = String(
      Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000,
    );

    await client.query(
      `INSERT INTO orders.orders
         (id, user_id, event_id, status, total_amount, currency, locale,
          gopay_payment_id, payment_provider, idempotency_key,
          discount_halire, requires_age_verification,
          variable_symbol, expires_at,
          created_at, updated_at)
       VALUES ($1, $2, $3, 'pending', $4, $5, 'cs',
               $6, $7, $8,
               0, FALSE,
               $9, NOW() + ($10 || ' days')::interval,
               NOW(), NOW())`,
      [
        orderId,
        userId,
        parsed.data.eventId,
        totalAmount,
        t.currency,
        `reserv-${orderId.slice(0, 8)}`,
        parsed.data.paymentMethod,
        randomUUID(),
        variableSymbol,
        String(parsed.data.reservationExpiryDays),
      ],
    );
    await client.query(
      `INSERT INTO orders.order_items
         (order_id, ticket_type_id, quantity, unit_price, total_price)
       VALUES ($1, $2, $3, $4, $5)`,
      [orderId, t.id, parsed.data.quantity, t.base_price, totalAmount],
    );

    // Decrement inventory hned — držíme rezervaci do expires_at
    await client.query(
      `UPDATE catalog.ticket_types
       SET remaining_qty = remaining_qty - $2
       WHERE id = $1`,
      [t.id, parsed.data.quantity],
    );

    // Audit log
    await client.query(
      `INSERT INTO audit.audit_log
         (schema_name, table_name, record_id, action, actor_id, actor_type, new_values)
       VALUES ('orders', 'orders', $1, 'INSERT', $2, 'user', $3::jsonb)`,
      [
        orderId,
        promoter.userId,
        JSON.stringify({
          kind: 'reservation_created',
          buyer_email: parsed.data.buyerEmail,
          buyer_name: parsed.data.buyerName,
          company_name: parsed.data.companyName,
          company_vat_id: parsed.data.companyVatId,
          internal_note: parsed.data.internalNote,
          variable_symbol: variableSymbol,
          expires_in_days: parsed.data.reservationExpiryDays,
        }),
      ],
    );

    await client.query('COMMIT');

    // Send reservation email k buyer
    void (async () => {
      try {
        const { sendMail } = await import('@/lib/email/mailer');
        const expiryDate = new Date(
          Date.now() + parsed.data.reservationExpiryDays * 86400_000,
        ).toLocaleDateString('cs-CZ');
        const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
        await sendMail({
          to: parsed.data.buyerEmail,
          subject: `Tixly — rezervace vstupenek (platí do ${expiryDate})`,
          html: `<!DOCTYPE html><html><body style="font-family:system-ui;max-width:600px;padding:24px">
            <h1>Rezervace vstupenek</h1>
            <p>Dobrý den ${parsed.data.buyerName},</p>
            <p>Rezervujeme pro tebe ${parsed.data.quantity}× vstupenek za celkem <strong>${(totalAmount / 100).toLocaleString('cs-CZ')} Kč</strong>.</p>
            <p>Pro potvrzení převeď částku do <strong>${expiryDate}</strong>:</p>
            <table style="margin:16px 0;border-collapse:collapse">
              <tr><td><strong>Variabilní symbol:</strong></td><td>${variableSymbol}</td></tr>
              <tr><td><strong>Částka:</strong></td><td>${(totalAmount / 100).toLocaleString('cs-CZ')} Kč</td></tr>
              <tr><td><strong>Zpráva:</strong></td><td>Rezervace ${orderId.slice(0, 8)}</td></tr>
            </table>
            <p>Detail objednávky: <a href="${appUrl}/cs/order-confirmation/${orderId}">${appUrl}/cs/order-confirmation/${orderId}</a></p>
            <p style="color:#666;font-size:12px">Bankovní účet ti pošleme samostatně.</p>
          </body></html>`,
        });
      } catch (err) {
        console.error('[reservation] email failed:', err);
      }
    })();

    return NextResponse.json({
      ok: true,
      orderId,
      variableSymbol,
      totalHalire: totalAmount,
      expiresInDays: parsed.data.reservationExpiryDays,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[reservation]', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  } finally {
    client.release();
  }
}
