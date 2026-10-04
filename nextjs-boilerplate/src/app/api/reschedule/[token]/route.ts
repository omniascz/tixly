import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runWithServiceContext } from '@/lib/db/rls-pool';
import { GATEWAY_REFUND_PROVIDERS, refundOrderFully } from '@/lib/orders/refund-full-order';
import { z } from 'zod';

const postSchema = z.object({
  response: z.enum(['accepted', 'refund_requested']),
});

interface ResponseInfoRow {
  response_id: string;
  reschedule_id: string;
  order_id: string;
  response: string | null;
  responded_at: string | null;
  response_deadline: string | null;
  offer_refund: boolean;
  new_event_id: string | null;
  original_title: string;
  original_date: string;
  new_event_title: string | null;
  new_event_date: string | null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  return runWithServiceContext(async () => {
    const { token } = await params;

    const r = await db().query<ResponseInfoRow>(
      `SELECT
         rr.id AS response_id,
         rr.reschedule_id,
         rr.order_id,
         rr.response,
         rr.responded_at::text,
         er.response_deadline::text,
         er.offer_refund,
         er.new_event_id,
         oe.title AS original_title,
         oe.date_start::text AS original_date,
         ne.title AS new_event_title,
         ne.date_start::text AS new_event_date
       FROM orders.reschedule_responses rr
       JOIN catalog.event_reschedules er ON er.id = rr.reschedule_id
       JOIN catalog.events oe ON oe.id = er.original_event_id
       LEFT JOIN catalog.events ne ON ne.id = er.new_event_id
       WHERE rr.response_token = $1`,
      [token],
    );

    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const row = r.rows[0];

    return NextResponse.json({
      originalEvent: {
        title: row.original_title,
        date: row.original_date,
      },
      newEvent: row.new_event_id
        ? { title: row.new_event_title, date: row.new_event_date }
        : null,
      offerRefund: row.offer_refund,
      responseDeadline: row.response_deadline,
      alreadyResponded: row.response !== null,
    });
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  return runWithServiceContext(async () => {
    const { token } = await params;

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
    }
    const { response } = parsed.data;

    const rawPool = db();
    const client = await rawPool.connect();
    try {
      await client.query('BEGIN');

      const lockResult = await client.query<{
        id: string;
        order_id: string;
        response: string | null;
        response_deadline: string | null;
        offer_refund: boolean;
        new_event_id: string | null;
        reschedule_id: string;
      }>(
        `SELECT
           rr.id, rr.order_id, rr.response,
           er.response_deadline::text,
           er.offer_refund,
           er.new_event_id,
           er.id AS reschedule_id
         FROM orders.reschedule_responses rr
         JOIN catalog.event_reschedules er ON er.id = rr.reschedule_id
         WHERE rr.response_token = $1
         FOR UPDATE OF rr`,
        [token],
      );

      if (lockResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
      }

      const row = lockResult.rows[0];

      if (row.response !== null) {
        await client.query('ROLLBACK');
        return NextResponse.json({ ok: true, response: row.response, alreadyResponded: true });
      }

      if (row.response_deadline && new Date(row.response_deadline) < new Date()) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'DEADLINE_PASSED' }, { status: 410 });
      }

      await client.query(
        `UPDATE orders.reschedule_responses
         SET response = $1, responded_at = NOW()
         WHERE id = $2`,
        [response, row.id],
      );

      if (response === 'accepted' && row.new_event_id) {
        const newTicketType = await client.query<{ id: string }>(
          `SELECT id FROM catalog.ticket_types
           WHERE event_id = $1
           LIMIT 1`,
          [row.new_event_id],
        );

        if (newTicketType.rows.length > 0) {
          const newTicketTypeId = newTicketType.rows[0].id;

          await client.query(
            `UPDATE orders.order_items
             SET ticket_type_id = $1
             WHERE order_id = $2`,
            [newTicketTypeId, row.order_id],
          );

          // Kolo 8 / krok 7: tickets.tickets nemá event_id (42703 → přijetí nového termínu padalo);
          // vstupenka patří termínu přes ticket_type_id.
          await client.query(
            `UPDATE tickets.tickets
             SET ticket_type_id = $1, updated_at = NOW()
             WHERE order_id = $2 AND status = 'valid'`,
            [newTicketTypeId, row.order_id],
          );
        }
      }

      // Kolo 8 / krok 7: dřív se tu objednávka přepnula na status 'refund_requested', který orders.orders nezná
      // (CHECK → 500), a peníze se nevracely. Teď: po COMMIT existující cesta refundu (níže).

      const countColumn =
        response === 'accepted' ? 'accepted_count' : 'refund_count';

      await client.query(
        `UPDATE catalog.event_reschedules
         SET ${countColumn} = ${countColumn} + 1
         WHERE id = $1`,
        [row.reschedule_id],
      );

      await client.query('COMMIT');

      if (response === 'refund_requested') {
        // online platba → vrácení přes bránu (sdílená cesta s hromadným refundem); pokladna / faktura → ruční vrácení
        const o = (await db().query<{ status: string; payment_provider: string | null }>(
          `SELECT status, payment_provider FROM orders.orders WHERE id = $1`, [row.order_id],
        )).rows[0];
        let outcome: 'refunded' | 'manual' | 'failed' = 'manual';
        if (o && GATEWAY_REFUND_PROVIDERS.includes(o.payment_provider ?? '') && ['paid', 'paid_partial'].includes(o.status)) {
          const r = await refundOrderFully(row.order_id, {
            actorUserId: null, kind: 'reschedule_refund', reason: 'Kupec požádal o vrácení po přesunu termínu', previousStatus: o.status,
          }).catch(() => null);
          outcome = r && (r.outcome === 'refunded' || r.outcome === 'already') ? 'refunded' : 'failed';
        }
        await db().query(`UPDATE orders.reschedule_responses SET refund_outcome = $2 WHERE id = $1`, [row.id, outcome]);
        return NextResponse.json({ ok: true, response, refund: outcome });
      }

      return NextResponse.json({ ok: true, response });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });
}
