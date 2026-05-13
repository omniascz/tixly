/**
 * GET  /api/admin/broadcasts?eventId=...  — historie odeslaných zpráv promotéra
 * POST /api/admin/broadcasts              — vytvoří broadcast + odešle
 *
 * Body POST:
 *   { eventId, subject, body, filter: 'all_buyers'|'paid_only'|'ticket_type'|'waitlist',
 *     ticketTypeId?: uuid }
 *
 * Vybere recipients podle filtru z DB, vyrobí `marketing.event_broadcasts` row,
 * fire-and-forget volání na `/api/internal/broadcast-send` (in-process tex).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Pool } from 'pg';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const createSchema = z.object({
  eventId: z.string().uuid(),
  subject: z.string().min(3).max(200),
  body: z.string().min(10).max(10_000),
  filter: z.enum(['all_buyers', 'paid_only', 'ticket_type', 'waitlist', 'followers']),
  ticketTypeId: z.string().uuid().optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const eventId = req.nextUrl.searchParams.get('eventId');
  const args: unknown[] = [promoter.promoterId];
  let where = `b.promoter_id = $1`;
  if (eventId) {
    args.push(eventId);
    where += ` AND b.event_id = $${args.length}`;
  }

  const r = await db().query<{
    id: string;
    event_id: string;
    event_title: string;
    subject: string;
    filter: string;
    recipients_count: number;
    sent_count: number;
    failed_count: number;
    status: string;
    created_at: string;
    completed_at: string | null;
  }>(
    `SELECT b.id, b.event_id, e.title AS event_title, b.subject, b.filter,
            b.recipients_count, b.sent_count, b.failed_count, b.status,
            b.created_at, b.completed_at
     FROM marketing.event_broadcasts b
     JOIN catalog.events e ON e.id = b.event_id
     WHERE ${where}
     ORDER BY b.created_at DESC
     LIMIT 100`,
    args,
  );

  return NextResponse.json({
    broadcasts: r.rows.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      eventTitle: row.event_title,
      subject: row.subject,
      filter: row.filter,
      recipientsCount: row.recipients_count,
      sentCount: row.sent_count,
      failedCount: row.failed_count,
      status: row.status,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    })),
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;

  // 1) Event musí patřit promotérovi
  const evRes = await db().query<{ promoter_id: string | null }>(
    `SELECT promoter_id FROM catalog.events WHERE id = $1`,
    [input.eventId],
  );
  const ev = evRes.rows[0];
  if (!ev || ev.promoter_id !== promoter.promoterId) {
    return NextResponse.json({ error: 'EVENT_FORBIDDEN' }, { status: 403 });
  }

  // 2) Selektor recipientů
  let recipientQuery: string;
  const recipientArgs: unknown[] = [input.eventId];
  switch (input.filter) {
    case 'all_buyers':
      // Všichni unikátní kupci, kteří mají alespoň 1 order na tomto eventu
      recipientQuery = `
        SELECT DISTINCT u.id AS user_id, u.email, u.name
        FROM orders.orders o
        JOIN identity.users u ON u.id = o.user_id
        WHERE o.event_id = $1
          AND u.deleted_at IS NULL
          AND u.email NOT LIKE 'walkin+%'`;
      break;
    case 'paid_only':
      recipientQuery = `
        SELECT DISTINCT u.id AS user_id, u.email, u.name
        FROM orders.orders o
        JOIN identity.users u ON u.id = o.user_id
        WHERE o.event_id = $1
          AND o.status = 'paid'
          AND u.deleted_at IS NULL
          AND u.email NOT LIKE 'walkin+%'`;
      break;
    case 'ticket_type':
      if (!input.ticketTypeId) {
        return NextResponse.json(
          { error: 'ticketTypeId required for filter=ticket_type' },
          { status: 422 },
        );
      }
      recipientArgs.push(input.ticketTypeId);
      recipientQuery = `
        SELECT DISTINCT u.id AS user_id, u.email, u.name
        FROM orders.orders o
        JOIN orders.order_items oi ON oi.order_id = o.id
        JOIN identity.users u ON u.id = o.user_id
        WHERE o.event_id = $1
          AND oi.ticket_type_id = $2
          AND o.status = 'paid'
          AND u.deleted_at IS NULL
          AND u.email NOT LIKE 'walkin+%'`;
      break;
    case 'waitlist':
      recipientQuery = `
        SELECT DISTINCT u.id AS user_id, u.email, u.name
        FROM catalog.waitlist_entries w
        JOIN identity.users u ON u.id = w.user_id
        WHERE w.event_id = $1
          AND u.deleted_at IS NULL`;
      break;
    case 'followers':
      // Newsletter subscribers tohoto promotéra (z FollowButton na /p/[slug])
      // Použijeme $1 = promoter_id; ale máme $1 = event_id — musíme injection změnit
      recipientArgs[0] = ev.promoter_id; // přepíšeme event_id na promoter_id
      recipientQuery = `
        SELECT DISTINCT COALESCE(u.id, gen_random_uuid()) AS user_id,
               ns.email, ns.name
        FROM marketing.newsletter_subscribers ns
        LEFT JOIN identity.users u ON LOWER(u.email) = LOWER(ns.email)
        WHERE ns.promoter_id = $1
          AND ns.status = 'confirmed'
          AND ns.unsubscribed_at IS NULL
          AND (u.deleted_at IS NULL OR u.id IS NULL)`;
      break;
  }

  const recipientsRes = await db().query<{ user_id: string; email: string; name: string | null }>(
    recipientQuery,
    recipientArgs,
  );
  const recipients = recipientsRes.rows.map((r) => ({
    userId: r.user_id,
    email: r.email,
    name: r.name,
  }));

  if (recipients.length === 0) {
    return NextResponse.json(
      { error: 'NO_RECIPIENTS', message: 'Pro tento filtr žádní příjemci.' },
      { status: 422 },
    );
  }

  // 3) Insert broadcast row (status='sending', counts=0)
  const bRes = await db().query<{ id: string }>(
    `INSERT INTO marketing.event_broadcasts
       (event_id, promoter_id, sent_by_user_id, subject, body, filter,
        ticket_type_id, recipients_count, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'sending')
     RETURNING id`,
    [
      input.eventId,
      promoter.promoterId,
      promoter.userId,
      input.subject,
      input.body,
      input.filter,
      input.ticketTypeId ?? null,
      recipients.length,
    ],
  );
  const broadcastId = bRes.rows[0]!.id;

  // 4) Fire-and-forget na internal route (v produkci queue/worker)
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  void fetch(`${baseUrl}/api/internal/broadcast-send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-token': internalToken,
    },
    body: JSON.stringify({
      broadcastId,
      subject: input.subject,
      body: input.body,
      recipients,
    }),
  }).catch((err) => console.error('[broadcasts dispatch]', err));

  return NextResponse.json({
    success: true,
    broadcastId,
    recipientsCount: recipients.length,
  });
}
