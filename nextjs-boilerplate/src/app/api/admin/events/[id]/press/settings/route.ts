import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';

async function ownsEvent(eventId: string, promoterId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return false;
  const r = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM catalog.events
     WHERE id = $1 AND promoter_id = $2`,
    [eventId, promoterId],
  );
  return Number(r.rows[0]?.count ?? 0) > 0;
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
      pressSeatsMax?: number;
      pressDeadline?: string | null;
    };

    if (body.pressSeatsMax !== undefined && (typeof body.pressSeatsMax !== 'number' || body.pressSeatsMax < 0)) {
      return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
    }

    const fields: string[] = [];
    const args: unknown[] = [];

    if (body.pressSeatsMax !== undefined) {
      args.push(body.pressSeatsMax);
      fields.push(`press_seats_max = $${args.length}`);
    }
    if ('pressDeadline' in body) {
      args.push(body.pressDeadline ?? null);
      fields.push(`press_deadline = $${args.length}`);
    }

    if (fields.length === 0) {
      return NextResponse.json({ error: 'NOTHING_TO_UPDATE' }, { status: 422 });
    }

    args.push(eventId);
    const r = await db().query<{ press_seats_max: number; press_deadline: string | null }>(
      `UPDATE catalog.events
       SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${args.length}
       RETURNING press_seats_max, press_deadline`,
      args,
    );

    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    return NextResponse.json({ settings: r.rows[0] });
  });
}
