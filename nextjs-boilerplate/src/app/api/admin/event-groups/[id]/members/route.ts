/**
 * POST   /api/admin/event-groups/[id]/members             — add event
 *   Body: { eventId, isPrimary? }
 * DELETE /api/admin/event-groups/[id]/members?eventId=... — remove event
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';
import { z } from 'zod';


async function ownsGroupAndEvent(
  groupId: string,
  eventId: string,
  promoterId: string,
): Promise<boolean> {
  const r = await db().query(
    `SELECT 1
       FROM event_groups.groups g
       JOIN catalog.events e ON e.promoter_id = g.promoter_id
      WHERE g.id = $1 AND e.id = $2 AND g.promoter_id = $3`,
    [groupId, eventId, promoterId],
  );
  return r.rows.length > 0;
}

const postSchema = z.object({
  eventId: z.string().uuid(),
  isPrimary: z.boolean().default(false),
  orderIndex: z.number().int().min(0).default(0),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const { id: groupId } = await params;

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
  }

  if (!(await ownsGroupAndEvent(groupId, parsed.data.eventId, promoter.promoterId))) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  await db().query(
    `INSERT INTO event_groups.members (group_id, event_id, is_primary, order_index)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (group_id, event_id) DO UPDATE SET
       is_primary = EXCLUDED.is_primary,
       order_index = EXCLUDED.order_index`,
    [groupId, parsed.data.eventId, parsed.data.isPrimary, parsed.data.orderIndex],
  );

  return NextResponse.json({ ok: true });

  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const { id: groupId } = await params;
  const eventId = req.nextUrl.searchParams.get('eventId');
  if (!eventId || !/^[0-9a-f-]{36}$/i.test(eventId)) {
    return NextResponse.json({ error: 'INVALID_EVENT_ID' }, { status: 400 });
  }

  if (!(await ownsGroupAndEvent(groupId, eventId, promoter.promoterId))) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  await db().query(
    `DELETE FROM event_groups.members WHERE group_id = $1 AND event_id = $2`,
    [groupId, eventId],
  );

  return NextResponse.json({ ok: true });

  });
}
