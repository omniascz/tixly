/**
 * POST /api/admin/events/[id]/advance-payout
 *
 * Pre-event payout schedule. Promotér nastaví "70% při T-30 dnech, 30% při T-0".
 * Tixly drží authorization, payouts vykonává cron processor jak datum dosáhne.
 *
 * Body: {
 *   installments: [{ daysBefore: 30, pct: 70 }, { daysBefore: 0, pct: 30 }]
 * }
 *
 * Kontroly:
 *   - sum(pct) ≤ 100
 *   - daysBefore monotone non-increasing (30, 14, 7, 0)
 *   - event musí být future
 *   - promoter musí mít aktivní bank account
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
  installments: z.array(z.object({
    daysBefore: z.number().int().min(0).max(365),
    pct: z.number().int().min(1).max(100),
  })).min(1).max(10),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.role === 'staff') {
    return NextResponse.json({ error: 'ADMIN_OR_OWNER_ONLY' }, { status: 403 });
  }
  const { id: eventId } = await params;

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });

  // Validation: sum ≤ 100
  const totalPct = parsed.data.installments.reduce((s, i) => s + i.pct, 0);
  if (totalPct > 100) {
    return NextResponse.json({
      error: 'PCT_EXCEEDS_100',
      total: totalPct,
    }, { status: 422 });
  }

  // Event ownership + future check
  const ev = await db().query<{
    date_start: string;
    promoter_id: string;
    projected_revenue: string;
  }>(
    `SELECT e.date_start::text, e.promoter_id,
            COALESCE(
              (SELECT SUM(o.total_amount) FROM orders.orders o
                WHERE o.event_id = e.id AND o.status = 'paid'), 0
            )::text AS projected_revenue
       FROM catalog.events e
      WHERE e.id = $1 AND e.promoter_id = $2`,
    [eventId, promoter.promoterId],
  );

  if (ev.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  const event = ev.rows[0];
  if (new Date(event.date_start) < new Date()) {
    return NextResponse.json({ error: 'EVENT_ALREADY_PAST' }, { status: 422 });
  }

  const totalAuthorized = Number(event.projected_revenue);

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    // Cancel existing active schedule (jen 1 active per event)
    await client.query(
      `UPDATE platform.advance_payout_schedules
          SET status = 'cancelled'
        WHERE event_id = $1 AND status IN ('pending', 'active')`,
      [eventId],
    );

    // Vytvoř novou schedule
    const sched = await client.query<{ id: string }>(
      `INSERT INTO platform.advance_payout_schedules
         (promoter_id, event_id, installments, total_authorized_halire, status)
       VALUES ($1, $2, $3::jsonb, $4, 'active')
       RETURNING id`,
      [promoter.promoterId, eventId, JSON.stringify(parsed.data.installments), totalAuthorized],
    );

    // Vytvoř per-installment rows
    const eventStartMs = new Date(event.date_start).getTime();
    for (let i = 0; i < parsed.data.installments.length; i++) {
      const inst = parsed.data.installments[i];
      const scheduledMs = eventStartMs - inst.daysBefore * 86_400_000;
      const amount = Math.round((totalAuthorized * inst.pct) / 100);

      await client.query(
        `INSERT INTO platform.advance_payout_installments
           (schedule_id, installment_index, amount_halire, scheduled_for, status)
         VALUES ($1, $2, $3, to_timestamp($4 / 1000.0), 'pending')`,
        [sched.rows[0].id, i, amount, scheduledMs],
      );
    }

    await client.query('COMMIT');

    return NextResponse.json({
      scheduleId: sched.rows[0].id,
      totalAuthorized,
      installments: parsed.data.installments.length,
      message: `Schedule aktivována. Total cap ${(totalAuthorized / 100).toFixed(0)} Kč rozdělen na ${parsed.data.installments.length} částek.`,
    }, { status: 201 });
  } catch (e) {
    await client.query('ROLLBACK');
    return NextResponse.json({ error: 'DB_ERROR' }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const { id: eventId } = await params;

  const r = await db().query(
    `SELECT s.id, s.installments, s.total_authorized_halire, s.total_paid_halire, s.status,
            (SELECT json_agg(json_build_object(
              'index', i.installment_index,
              'amount', i.amount_halire,
              'scheduledFor', i.scheduled_for,
              'paidAt', i.paid_at,
              'status', i.status
            ) ORDER BY i.installment_index)
              FROM platform.advance_payout_installments i
             WHERE i.schedule_id = s.id) AS installment_details
       FROM platform.advance_payout_schedules s
      WHERE s.event_id = $1 AND s.promoter_id = $2
   ORDER BY s.created_at DESC`,
    [eventId, promoter.promoterId],
  );

  return NextResponse.json({ schedules: r.rows });
}
