/**
 * POST /api/admin/events/[id]/postpone
 *
 * TM Postponed status — odloží akci (NE zrušit). Tickety zůstávají platné.
 * Buyer dostane oznámení, ale žádný auto-refund (vyžaduje promotér).
 *
 * Body: { reason, expectedDecisionAt?, rescheduledTo? }
 *
 * Pokud `rescheduledTo` zadáno → confirm postpone + nové datum (event.date_start updates).
 * Pokud jen `expectedDecisionAt` → still TBD, original date stays.
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
  reason: z.string().min(2).max(1000),
  expectedDecisionAt: z.string().datetime().optional(),
  rescheduledTo: z.string().datetime().optional(),
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

  const r = await db().query(
    `UPDATE catalog.events
        SET postponed_at = now(),
            postponed_reason = $1,
            expected_decision_at = $2::timestamptz,
            original_date_start = COALESCE(original_date_start, date_start),
            rescheduled_to_date = $3::timestamptz,
            date_start = COALESCE($3::timestamptz, date_start),
            updated_at = now()
      WHERE id = $4 AND promoter_id = $5
    RETURNING id, original_date_start::text AS original, date_start::text AS new_date`,
    [
      parsed.data.reason,
      parsed.data.expectedDecisionAt ?? null,
      parsed.data.rescheduledTo ?? null,
      eventId, promoter.promoterId,
    ],
  );

  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  // Notify všechny buyery (fire-and-forget broadcast)
  void db().query(
    `INSERT INTO marketing.event_broadcasts
       (event_id, promoter_id, subject, body, channel, sent_by_user_id, status)
     VALUES ($1, $2, $3, $4, 'email', $5, 'queued')`,
    [
      eventId, promoter.promoterId,
      `Akce odložena${parsed.data.rescheduledTo ? ' — nový termín' : ''}`,
      `Akce byla odložena. Důvod: ${parsed.data.reason}. ` +
      (parsed.data.rescheduledTo
        ? `Nový termín: ${new Date(parsed.data.rescheduledTo).toLocaleString('cs-CZ')}.`
        : 'Nový termín bude oznámen.'),
      promoter.userId,
    ],
  ).catch(() => null);

  return NextResponse.json({
    ok: true,
    postponed: true,
    rescheduled: parsed.data.rescheduledTo !== undefined,
    originalDate: r.rows[0].original,
    newDate: r.rows[0].new_date,
  });
}

/**
 * DELETE /api/admin/events/[id]/postpone
 * Cancel postpone (uvolnit, vrátit na original date)
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.role === 'staff') {
    return NextResponse.json({ error: 'ADMIN_OR_OWNER_ONLY' }, { status: 403 });
  }
  const { id: eventId } = await params;

  const r = await db().query(
    `UPDATE catalog.events
        SET postponed_at = NULL,
            postponed_reason = NULL,
            expected_decision_at = NULL,
            rescheduled_to_date = NULL,
            date_start = COALESCE(original_date_start, date_start),
            original_date_start = NULL,
            updated_at = now()
      WHERE id = $1 AND promoter_id = $2
    RETURNING id`,
    [eventId, promoter.promoterId],
  );

  if (r.rows.length === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
