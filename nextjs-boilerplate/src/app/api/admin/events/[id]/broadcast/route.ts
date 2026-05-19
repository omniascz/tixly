/**
 * POST /api/admin/events/[id]/broadcast
 * Body: { subject, body, filter: 'all_buyers' | 'paid_only' | 'ticket_type' | 'waitlist',
 *         ticketTypeId? (when filter='ticket_type') }
 *
 * Pošle hromadný e-mail buyerům akce. Podle filtru:
 *   - all_buyers: všichni kdo si koupili (paid + paid_partial + pending)
 *   - paid_only: pouze paid + paid_partial
 *   - ticket_type: jen kdo má ticket konkrétního typu
 *   - waitlist: jen lidé na waitlistu (žádný order)
 *
 * Odesílá se asynchronně přes /api/internal/broadcast-send (cron-style).
 *
 * GET vrátí historii broadcastů pro event.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const schema = z.object({
  subject: z.string().min(2).max(200),
  body: z.string().min(2).max(10_000),
  filter: z.enum(['all_buyers', 'paid_only', 'ticket_type', 'waitlist']),
  ticketTypeId: z.string().uuid().optional(),
});

interface RecipientRow {
  email: string;
  name: string | null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;
  if (input.filter === 'ticket_type' && !input.ticketTypeId) {
    return NextResponse.json(
      { error: 'TICKET_TYPE_REQUIRED', message: 'Filter ticket_type vyžaduje ticketTypeId.' },
      { status: 422 },
    );
  }

  // Ownership check
  const owns = await db().query<{ title: string }>(
    `SELECT title FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
    [params.id, promoter.promoterId],
  );
  if (owns.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Resolve recipients
  let recipients: RecipientRow[] = [];
  if (input.filter === 'waitlist') {
    const r = await db().query<RecipientRow>(
      `SELECT we.email, we.name FROM catalog.waitlist_entries we
       JOIN catalog.ticket_types tt ON tt.id = we.ticket_type_id
       WHERE tt.event_id = $1 AND we.status IN ('waiting', 'notified')`,
      [params.id],
    );
    recipients = r.rows;
  } else {
    const conditions: string[] = [`o.event_id = $1`];
    const args: unknown[] = [params.id];
    if (input.filter === 'paid_only') {
      conditions.push(`o.status IN ('paid', 'paid_partial')`);
    } else if (input.filter === 'all_buyers') {
      conditions.push(`o.status IN ('paid', 'paid_partial', 'pending')`);
    } else if (input.filter === 'ticket_type') {
      args.push(input.ticketTypeId);
      conditions.push(`o.id IN (
        SELECT order_id FROM orders.order_items WHERE ticket_type_id = $${args.length}
      )`);
      conditions.push(`o.status IN ('paid', 'paid_partial')`);
    }

    const r = await db().query<RecipientRow>(
      `SELECT DISTINCT u.email, u.name
       FROM orders.orders o
       JOIN identity.users u ON u.id = o.user_id
       WHERE ${conditions.join(' AND ')} AND u.anonymized_at IS NULL`,
      args,
    );
    recipients = r.rows;
  }

  // Create broadcast row
  const r = await db().query<{ id: string }>(
    `INSERT INTO marketing.event_broadcasts
       (event_id, promoter_id, sent_by_user_id, subject, body, filter, ticket_type_id,
        recipients_count, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'sending')
     RETURNING id`,
    [
      params.id,
      promoter.promoterId,
      promoter.userId,
      input.subject,
      input.body,
      input.filter,
      input.ticketTypeId ?? null,
      recipients.length,
    ],
  );
  const broadcastId = r.rows[0].id;

  // Trigger async send (fire-and-forget)
  void fetch(
    `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/internal/broadcast-send`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-token': process.env.INTERNAL_SERVICE_TOKEN ?? '',
      },
      body: JSON.stringify({
        broadcastId,
        subject: input.subject,
        body: input.body,
        recipients,
      }),
    },
  ).catch((err) => console.error('[broadcast trigger]', err));

  return NextResponse.json(
    { id: broadcastId, recipientsCount: recipients.length, status: 'sending' },
    { status: 201 },
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const owns = await db().query(
    `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
    [params.id, promoter.promoterId],
  );
  if (owns.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const r = await db().query<{
    id: string;
    subject: string;
    filter: string;
    recipients_count: number;
    sent_count: number;
    failed_count: number;
    status: string;
    created_at: string;
    completed_at: string | null;
  }>(
    `SELECT id, subject, filter, recipients_count, sent_count, failed_count, status,
            created_at, completed_at
     FROM marketing.event_broadcasts
     WHERE event_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [params.id],
  );
  return NextResponse.json({ broadcasts: r.rows });
}
