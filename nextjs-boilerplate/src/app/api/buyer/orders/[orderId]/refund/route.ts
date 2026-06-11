/**
 * POST /api/buyer/orders/[orderId]/refund
 *
 * Self-service refund pro buyera.
 *
 * Předpoklady:
 *   1. Buyer je vlastník objednávky (orders.user_id === x-user-id)
 *   2. Promotér v settings povolil `allow_customer_self_refund = true`
 *   3. Objednávka je `paid` (ne refunded ani jiná)
 *   4. Aktuální čas je v rámci `refund_window_days` od `paid_at`
 *   5. Volitelný `auto_approve_under_halire`: pokud částka ≤ limit, refund proběhne hned
 *      jinak vytvoří request pro promotéra (TODO: tabulka refund_requests)
 *
 * V této implementaci provedeme refund hned bez approval workflow
 * (zjednodušení). Stejné SQL kroky jako admin refund (status, tickets, seats,
 * remaining_qty, audit log).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { z } from 'zod';


const schema = z.object({
  reason: z.string().max(500).optional(),
  ticketIds: z.array(z.string().uuid()).max(100).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { orderId: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_INPUT' }, { status: 422 });
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    // 1) Order musí patřit tomuto user-id + být paid
    const orderRes = await client.query<{
      id: string;
      status: string;
      total_amount: number;
      paid_at: string | null;
      currency: string;
      event_id: string | null;
      event_promoter_id: string | null;
      event_title: string | null;
      event_date_start: string | null;
      event_refund_deadline_days: number | null;
      event_refund_fee_pct: number | null;
      event_refund_fee_min_halire: number | null;
    }>(
      `SELECT o.id, o.status, o.total_amount, o.paid_at, o.currency,
              o.event_id,
              e.promoter_id AS event_promoter_id,
              e.title AS event_title,
              e.date_start AS event_date_start,
              e.refund_deadline_days AS event_refund_deadline_days,
              e.refund_fee_pct AS event_refund_fee_pct,
              e.refund_fee_min_halire AS event_refund_fee_min_halire
       FROM orders.orders o
       LEFT JOIN catalog.events e ON e.id = o.event_id
       WHERE o.id = $1 AND o.user_id = $2
       FOR UPDATE OF o`,
      [params.orderId, userId],
    );
    if (orderRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    const o = orderRes.rows[0];
    if (o.status !== 'paid') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'NOT_REFUNDABLE', currentStatus: o.status },
        { status: 409 },
      );
    }
    if (!o.event_promoter_id) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'NO_PROMOTER' }, { status: 422 });
    }

    // 2) Promoter refund policy
    const policyRes = await client.query<{
      allow_self: boolean;
      window_days: number;
      max_pct: number;
      auto_approve_under_halire: number;
    }>(
      `SELECT
         COALESCE(rp.allow_customer_self_refund, false) AS allow_self,
         COALESCE(rp.refund_window_days, 14) AS window_days,
         COALESCE(rp.max_refund_pct, 100) AS max_pct,
         COALESCE(rp.auto_approve_under_halire, 0) AS auto_approve_under_halire
       FROM platform.promoters p
       LEFT JOIN platform.refund_policies rp ON rp.promoter_id = p.id
       WHERE p.id = $1`,
      [o.event_promoter_id],
    );
    const policy = policyRes.rows[0];
    if (!policy?.allow_self) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        {
          error: 'SELF_REFUND_DISABLED',
          message: 'Tento pořadatel nepovoluje self-service refund. Kontaktuj pořadatele přímo.',
        },
        { status: 403 },
      );
    }

    // 3) Refund window — hybrid hierarchie:
    //    a) Event-level: refund_deadline_days = N dní PŘED akcí (SMSticket model)
    //    b) Promoter-level fallback: refund_window_days = N dní PO platbě (legacy)
    //    Event-level vyhrává pokud je vyplněn.
    if (!o.paid_at) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'NOT_PAID' }, { status: 409 });
    }

    if (o.event_refund_deadline_days !== null && o.event_date_start) {
      // Per-event policy: refund self-service do X dní PŘED akcí
      const deadlineMs =
        new Date(o.event_date_start).getTime() -
        o.event_refund_deadline_days * 24 * 60 * 60 * 1000;
      if (Date.now() > deadlineMs) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'REFUND_DEADLINE_PASSED',
            message: `Refund je možný nejpozději ${o.event_refund_deadline_days} dní před akcí. Termín už vypršel.`,
          },
          { status: 409 },
        );
      }
      if (o.event_refund_deadline_days === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'REFUND_DISABLED_BY_EVENT',
            message: 'Tato akce nepovoluje refund.',
          },
          { status: 403 },
        );
      }
    } else {
      // Fallback: legacy promoter-level „dní po platbě"
      const paidAt = new Date(o.paid_at).getTime();
      const windowMs = policy.window_days * 24 * 60 * 60 * 1000;
      if (Date.now() > paidAt + windowMs) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'REFUND_WINDOW_EXPIRED',
            message: `Refund okno (${policy.window_days} dní od platby) vypršelo.`,
          },
          { status: 409 },
        );
      }
    }

    // 4) Refund: full (default) nebo partial (ticketIds podset)
    const isPartial = Array.isArray(parsed.data.ticketIds) && parsed.data.ticketIds.length > 0;

    let refundedHalire = 0;
    let revokedCount = 0;
    let remainingValid = 0;
    let revokedTicketIds: string[] = [];

    if (isPartial) {
      // Validace: všechny tickety patří k orderu a jsou valid
      const eligRes = await client.query<{ id: string; original_price: number }>(
        `SELECT id, original_price
         FROM tickets.tickets
         WHERE id = ANY($1::uuid[]) AND order_id = $2 AND status = 'valid'
         FOR UPDATE`,
        [parsed.data.ticketIds, params.orderId],
      );
      if (eligRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'NO_ELIGIBLE_TICKETS', message: 'Žádný z vybraných lístků nelze refundovat.' },
          { status: 409 },
        );
      }
      revokedTicketIds = eligRes.rows.map((r) => r.id);
      refundedHalire = eligRes.rows.reduce((s, r) => s + r.original_price, 0);
      revokedCount = eligRes.rows.length;

      await client.query(
        `UPDATE tickets.tickets
         SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
         WHERE id = ANY($1::uuid[])`,
        [revokedTicketIds],
      );

      // Restore inventory per ticket_type podle revoked count
      await client.query(
        `UPDATE catalog.ticket_types tt
         SET remaining_qty = remaining_qty + sub.qty
         FROM (
           SELECT ticket_type_id, COUNT(*)::int AS qty
           FROM tickets.tickets
           WHERE id = ANY($1::uuid[])
           GROUP BY ticket_type_id
         ) sub
         WHERE tt.id = sub.ticket_type_id`,
        [revokedTicketIds],
      );

      // Release sedadel pouze pro revoked tickety
      await client.query(
        `UPDATE catalog.event_seats
           SET status = 'available', order_id = NULL, ticket_id = NULL,
               hold_user_id = NULL, hold_until = NULL, updated_at = NOW()
         WHERE ticket_id = ANY($1::uuid[])
            OR id IN (SELECT seat_id FROM tickets.tickets
                      WHERE id = ANY($1::uuid[]) AND seat_id IS NOT NULL)`,
        [revokedTicketIds],
      );

      // Pokud po refundu nezůstal žádný valid lístek → order = refunded
      const remainRes = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM tickets.tickets
         WHERE order_id = $1 AND status = 'valid'`,
        [params.orderId],
      );
      remainingValid = Number(remainRes.rows[0]?.count ?? 0);
      if (remainingValid === 0) {
        await client.query(
          `UPDATE orders.orders SET status = 'refunded', updated_at = NOW() WHERE id = $1`,
          [params.orderId],
        );
      }
    } else {
      // Full refund (zachované původní chování)
      refundedHalire = o.total_amount;
      await client.query(
        `UPDATE orders.orders SET status = 'refunded', updated_at = NOW() WHERE id = $1`,
        [params.orderId],
      );
      const ticketRes = await client.query<{ count: string }>(
        `WITH revoked AS (
           UPDATE tickets.tickets
           SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
           WHERE order_id = $1 AND status <> 'revoked'
           RETURNING 1
         )
         SELECT COUNT(*)::text AS count FROM revoked`,
        [params.orderId],
      );
      revokedCount = Number(ticketRes.rows[0]?.count ?? 0);

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
        [params.orderId],
      );

      await client.query(
        `UPDATE catalog.event_seats
           SET status = 'available', order_id = NULL, ticket_id = NULL,
               hold_user_id = NULL, hold_until = NULL, updated_at = NOW()
         WHERE order_id = $1
            OR id IN (SELECT seat_id FROM orders.order_items
                      WHERE order_id = $1 AND seat_id IS NOT NULL)`,
        [params.orderId],
      );
    }

    // Refund fee — per-event > platform default
    const DEFAULT_FEE_BPS = 500; // 5 %
    const DEFAULT_FEE_MIN_HALIRE_CZK = 3000; // 30 Kč
    const DEFAULT_FEE_MIN_HALIRE_EUR = 120; // 1.20 EUR
    const feeBps = o.event_refund_fee_pct ?? DEFAULT_FEE_BPS;
    const feeMinHalire =
      o.event_refund_fee_min_halire ??
      (o.currency === 'EUR' ? DEFAULT_FEE_MIN_HALIRE_EUR : DEFAULT_FEE_MIN_HALIRE_CZK);
    const percentFeeHalire = Math.floor((refundedHalire * feeBps) / 10000);
    const refundFeeHalire =
      refundedHalire > 0 ? Math.max(percentFeeHalire, feeMinHalire) : 0;
    // Refund cap: fee nesmí být větší než refundovaná částka.
    const finalFeeHalire = Math.min(refundFeeHalire, refundedHalire);
    const netRefundHalire = refundedHalire - finalFeeHalire;

    await client.query(
      `INSERT INTO audit.audit_log
         (schema_name, table_name, record_id, action, actor_id, actor_type, new_values)
       VALUES ('orders', 'orders', $1, 'UPDATE', $2, 'user', $3::jsonb)`,
      [
        params.orderId,
        userId,
        JSON.stringify({
          kind: isPartial ? 'self_refund_partial' : 'self_refund',
          reason: parsed.data.reason ?? 'customer_self_service',
          revokedTickets: revokedCount,
          revokedTicketIds: isPartial ? revokedTicketIds : undefined,
          remainingValid: isPartial ? remainingValid : 0,
          grossRefundHalire: refundedHalire,
          refundFeeHalire: finalFeeHalire,
          refundFeeBps: feeBps,
          netRefundHalire,
        }),
      ],
    );

    await client.query('COMMIT');

    return NextResponse.json({
      ok: true,
      orderId: params.orderId,
      partial: isPartial,
      grossRefundHalire: refundedHalire,
      refundFeeHalire: finalFeeHalire,
      netRefundHalire,
      revokedTickets: revokedCount,
      remainingValid,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[POST /api/buyer/orders/[orderId]/refund]', e);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
