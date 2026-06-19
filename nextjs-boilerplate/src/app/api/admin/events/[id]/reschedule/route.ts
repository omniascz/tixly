import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

const postSchema = z.object({
  newEventId: z.string().uuid().optional(),
  reason: z.string().min(2).max(2000),
  offerRefund: z.boolean().optional(),
  responseDeadlineHours: z.number().int().min(1).max(720).optional(),
});

interface RescheduleRow {
  id: string;
  original_event_id: string;
  new_event_id: string | null;
  new_event_title: string | null;
  new_event_date: string | null;
  reason: string;
  offer_refund: boolean;
  response_deadline: string | null;
  sent_at: string | null;
  recipient_count: number;
  accepted_count: number;
  refund_count: number;
  created_at: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const { id: eventId } = await params;

    const owns = await db().query(
      `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
      [eventId, promoter.promoterId],
    );
    if (owns.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const r = await db().query<RescheduleRow>(
      `SELECT er.*,
              e.title AS new_event_title,
              e.date_start::text AS new_event_date
       FROM catalog.event_reschedules er
       LEFT JOIN catalog.events e ON e.id = er.new_event_id
       WHERE er.original_event_id = $1
       ORDER BY er.created_at DESC`,
      [eventId],
    );

    return NextResponse.json({ reschedules: r.rows });
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const { id: eventId } = await params;

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    }
    const input = parsed.data;

    const client = await db().connect();
    try {
      await client.query('BEGIN');

      const eventCheck = await client.query<{ id: string; title: string }>(
        `SELECT id, title FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
        [eventId, promoter.promoterId],
      );
      if (eventCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
      }

      if (input.newEventId) {
        const newEventCheck = await client.query(
          `SELECT id FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
          [input.newEventId, promoter.promoterId],
        );
        if (newEventCheck.rows.length === 0) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'NEW_EVENT_NOT_FOUND' }, { status: 404 });
        }
      }

      const offerRefund = input.offerRefund ?? true;
      const deadlineHours = input.responseDeadlineHours ?? 72;
      const responseDeadline = new Date(Date.now() + deadlineHours * 3600 * 1000).toISOString();

      const rescheduleInsert = await client.query<{ id: string }>(
        `INSERT INTO catalog.event_reschedules
           (original_event_id, new_event_id, promoter_id, reason, offer_refund, response_deadline)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          eventId,
          input.newEventId ?? null,
          promoter.promoterId,
          input.reason,
          offerRefund,
          responseDeadline,
        ],
      );
      const rescheduleId = rescheduleInsert.rows[0].id;

      const ordersResult = await client.query<{
        id: string;
        user_id: string;
        email: string;
        name: string | null;
      }>(
        `SELECT DISTINCT o.id, o.user_id, u.email, u.name
         FROM orders.orders o
         JOIN identity.users u ON u.id = o.user_id
         JOIN orders.order_items oi ON oi.order_id = o.id
         JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
         WHERE tt.event_id = $1
           AND o.status = 'paid'
           AND u.anonymized_at IS NULL`,
        [eventId],
      );

      const orders = ordersResult.rows;

      for (const order of orders) {
        const tokenResult = await client.query<{ response_token: string }>(
          `INSERT INTO orders.reschedule_responses
             (reschedule_id, order_id, user_id)
           VALUES ($1, $2, $3)
           RETURNING response_token`,
          [rescheduleId, order.id, order.user_id],
        );
        const token = tokenResult.rows[0].response_token;
        console.log(`Reschedule notification → ${order.email}: token=${token}`);
      }

      await client.query(
        `UPDATE catalog.event_reschedules
         SET sent_at = NOW(), recipient_count = $1, updated_at = NOW()
         WHERE id = $2`,
        [orders.length, rescheduleId],
      );

      await client.query('COMMIT');

      return NextResponse.json(
        {
          rescheduleId,
          recipientCount: orders.length,
          responseDeadline,
        },
        { status: 201 },
      );
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });
}
