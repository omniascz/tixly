/**
 * POST /api/admin/events/[id]/wallet-push
 *
 * Promotér broadcast push update pro všechny lístky eventu, které mají
 * registrované Apple Wallet zařízení. Zapíše do wallet_push_jobs queue.
 *
 * Body: { reason, payload?, scheduleAt? }
 *   reason: 'seat_changed' | 'gate_changed' | 'cancelled' | 'venue_changed' | 'reminder'
 *
 * Cron processor (samostatný skript) pak čte queue a posílá přes APNs.
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
  reason: z.enum(['seat_changed', 'gate_changed', 'cancelled', 'venue_changed', 'reminder']),
  payload: z.record(z.string(), z.unknown()).optional(),
  scheduleAt: z.string().datetime().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: eventId } = await params;
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
  }

  // Ownership check
  const own = await db().query(
    `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
    [eventId, promoter.promoterId],
  );
  if (own.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const scheduleAt = parsed.data.scheduleAt ?? new Date().toISOString();

  // Enqueue 1 job per ticket s registered wallet subscription
  const r = await db().query<{ inserted: string }>(
    `WITH tickets_with_passes AS (
       SELECT DISTINCT t.id AS ticket_id
         FROM tickets.tickets t
         JOIN orders.orders o ON o.id = t.order_id
         JOIN tickets.wallet_push_subscriptions wps ON wps.ticket_id = t.id
        WHERE o.event_id = $1
          AND wps.unregistered_at IS NULL
          AND t.status = 'valid'
     )
     INSERT INTO tickets.wallet_push_jobs (ticket_id, reason, payload, scheduled_for)
     SELECT ticket_id, $2, $3::jsonb, $4::timestamptz
       FROM tickets_with_passes
     RETURNING ticket_id`,
    [eventId, parsed.data.reason, JSON.stringify(parsed.data.payload ?? {}), scheduleAt],
  );

  // Audit log
  await db().query(
    `INSERT INTO tickets.pass_updates_log (ticket_id, field_changed, new_value, changed_by_user_id)
     SELECT t.id, $2, $3, $4
       FROM tickets.tickets t
       JOIN orders.orders o ON o.id = t.order_id
      WHERE o.event_id = $1 AND t.status = 'valid'`,
    [eventId, parsed.data.reason, JSON.stringify(parsed.data.payload ?? {}), promoter.userId],
  );

  return NextResponse.json({
    enqueued: r.rowCount ?? 0,
    reason: parsed.data.reason,
    scheduledFor: scheduleAt,
  }, { status: 201 });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const { id: eventId } = await params;

  const r = await db().query<{
    id: string;
    reason: string;
    status: string;
    scheduled_for: string;
    sent_at: string | null;
    payload: unknown;
    ticket_id: string;
  }>(
    `SELECT j.id, j.reason, j.status, j.scheduled_for::text, j.sent_at::text, j.payload, j.ticket_id
       FROM tickets.wallet_push_jobs j
       JOIN tickets.tickets t ON t.id = j.ticket_id
       JOIN orders.orders o ON o.id = t.order_id
      WHERE o.event_id = $1
   ORDER BY j.created_at DESC
      LIMIT 200`,
    [eventId],
  );

  return NextResponse.json({ jobs: r.rows });
}
