/**
 * PATCH  /api/admin/events/[id]/days/[dayId] — edit
 * DELETE /api/admin/events/[id]/days/[dayId] — remove (block pokud má redemptions)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';


const patchSchema = z.object({
  label: z.string().max(200).nullable().optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

async function ensureOwnership(eventId: string, promoterId: string): Promise<boolean> {
  const r = await db().query(
    `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2 LIMIT 1`,
    [eventId, promoterId],
  );
  return r.rows.length > 0;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; dayId: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
  if (!(await ensureOwnership(params.id, promoter.promoterId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 422 });
  }
  const input = parsed.data;
  const sets: string[] = [];
  const args: unknown[] = [];
  let i = 1;
  const colMap: Record<string, string> = {
    label: 'label',
    startsAt: 'starts_at',
    endsAt: 'ends_at',
    notes: 'notes',
  };
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    sets.push(`${colMap[k]} = $${i++}`);
    args.push(v);
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 422 });
  }
  args.push(params.dayId, params.id);
  const r = await db().query<{ id: string }>(
    `UPDATE catalog.event_days SET ${sets.join(', ')}
     WHERE id = $${i++} AND event_id = $${i}
     RETURNING id`,
    args,
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });

  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; dayId: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
  if (!(await ensureOwnership(params.id, promoter.promoterId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Block delete pokud existují redemptions
  const usage = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM tickets.ticket_redemptions WHERE event_day_id = $1`,
    [params.dayId],
  );
  if (Number(usage.rows[0]?.count ?? 0) > 0) {
    return NextResponse.json(
      {
        error: 'DAY_HAS_REDEMPTIONS',
        message: 'Den už má check-iny. Smažou-li se, ztratí se historie.',
      },
      { status: 409 },
    );
  }

  const r = await db().query<{ id: string }>(
    `DELETE FROM catalog.event_days
     WHERE id = $1 AND event_id = $2
     RETURNING id`,
    [params.dayId, params.id],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });

  });
}
