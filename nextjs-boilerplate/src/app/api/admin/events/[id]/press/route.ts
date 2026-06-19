import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { issueTicketsForOrder } from '@/lib/tickets/demo-issuer';
import { randomUUID } from 'crypto';

async function ownsEvent(eventId: string, promoterId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return false;
  const r = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM catalog.events
     WHERE id = $1 AND promoter_id = $2`,
    [eventId, promoterId],
  );
  return Number(r.rows[0]?.count ?? 0) > 0;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const { id: eventId } = await params;
    if (!(await ownsEvent(eventId, promoter.promoterId))) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const r = await db().query<{
      id: string;
      journalist_name: string;
      journalist_email: string;
      media_outlet: string;
      purpose: string | null;
      status: string;
      rejection_reason: string | null;
      ticket_id: string | null;
      order_id: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, journalist_name, journalist_email, media_outlet, purpose,
              status, rejection_reason, ticket_id, order_id, created_at, updated_at
       FROM orders.press_accreditations
       WHERE event_id = $1
       ORDER BY created_at`,
      [eventId],
    );

    const settingsRes = await db().query<{
      press_seats_max: number;
      press_deadline: string | null;
    }>(
      `SELECT press_seats_max, press_deadline FROM catalog.events WHERE id = $1`,
      [eventId],
    );

    const settings = settingsRes.rows[0] ?? { press_seats_max: 0, press_deadline: null };

    const approved = r.rows.filter((a) => a.status === 'approved').length;
    const pending = r.rows.filter((a) => a.status === 'pending').length;

    return NextResponse.json({
      accreditations: r.rows,
      settings,
      counts: { approved, pending, total: r.rows.length },
    });
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const { id: eventId } = await params;
    if (!(await ownsEvent(eventId, promoter.promoterId))) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      accreditationId?: string;
      status?: string;
      rejectionReason?: string;
    };

    if (!body.accreditationId || !body.status) {
      return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
    }
    if (!['approved', 'rejected'].includes(body.status)) {
      return NextResponse.json({ error: 'INVALID_STATUS' }, { status: 422 });
    }

    const accRes = await db().query<{
      id: string;
      journalist_name: string;
      journalist_email: string;
      media_outlet: string;
      status: string;
    }>(
      `SELECT id, journalist_name, journalist_email, media_outlet, status
       FROM orders.press_accreditations
       WHERE id = $1 AND event_id = $2`,
      [body.accreditationId, eventId],
    );

    if (accRes.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const acc = accRes.rows[0];

    if (body.status === 'rejected') {
      const r = await db().query<{ id: string; status: string; rejection_reason: string | null }>(
        `UPDATE orders.press_accreditations
         SET status = 'rejected', rejection_reason = $3, updated_at = NOW()
         WHERE id = $1 AND event_id = $2
         RETURNING id, status, rejection_reason`,
        [body.accreditationId, eventId, body.rejectionReason ?? null],
      );
      return NextResponse.json({ accreditation: r.rows[0] });
    }

    const client = await db().connect();
    try {
      await client.query('BEGIN');

      const ttRes = await client.query<{ id: string; currency: string }>(
        `SELECT id, currency FROM catalog.ticket_types
         WHERE event_id = $1 AND is_published = TRUE
         ORDER BY sort_order, created_at
         LIMIT 1`,
        [eventId],
      );
      if (ttRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'NO_TICKET_TYPE', message: 'Akce nemá žádný aktivní typ vstupenky.' },
          { status: 422 },
        );
      }
      const tt = ttRes.rows[0];

      const userRes = await client.query<{ id: string }>(
        `INSERT INTO identity.users (email, name, password_hash, status)
         VALUES (LOWER($1), $2, '', 'active')
         ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [acc.journalist_email, acc.journalist_name],
      );
      const userId = userRes.rows[0].id;

      const orderId = randomUUID();
      await client.query(
        `INSERT INTO orders.orders
           (id, user_id, event_id, status, total_amount, currency, locale,
            gopay_payment_id, payment_provider, idempotency_key,
            discount_halire, requires_age_verification, paid_at,
            expires_at, created_at, updated_at)
         VALUES ($1, $2, $3, 'paid', 0, $4, 'cs',
                 $5, 'free', $6,
                 0, FALSE, NOW(),
                 NOW() + INTERVAL '1 day', NOW(), NOW())`,
        [
          orderId,
          userId,
          eventId,
          tt.currency,
          `press-${randomUUID().slice(0, 8)}`,
          randomUUID(),
        ],
      );

      await client.query(
        `INSERT INTO orders.order_items
           (order_id, ticket_type_id, quantity, unit_price, total_price)
         VALUES ($1, $2, 1, 0, 0)`,
        [orderId, tt.id],
      );

      const tickets = await issueTicketsForOrder(orderId, client);
      const ticketId = tickets[0]?.ticketId ?? null;

      const r = await client.query<{
        id: string;
        status: string;
        ticket_id: string | null;
        order_id: string | null;
      }>(
        `UPDATE orders.press_accreditations
         SET status = 'approved', ticket_id = $3, order_id = $4, updated_at = NOW()
         WHERE id = $1 AND event_id = $2
         RETURNING id, status, ticket_id, order_id`,
        [body.accreditationId, eventId, ticketId, orderId],
      );

      await client.query('COMMIT');

      console.log(`Press ticket issued: ${acc.journalist_name} - ${acc.media_outlet}`);

      return NextResponse.json({ accreditation: r.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[PATCH press]', err);
      return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
