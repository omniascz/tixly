/**
 * POST /api/buyer/rsvp        — set/update RSVP { eventId, status }
 * DELETE /api/buyer/rsvp      — remove RSVP { eventId }
 * GET /api/buyer/rsvp?event=  — get my RSVP + counts pro event
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const postSchema = z.object({
  eventId: z.string().uuid(),
  status: z.enum(['interested', 'going', 'declined']),
  isPublic: z.boolean().default(true),
});

export async function GET(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  const eventId = req.nextUrl.searchParams.get('event');
  if (!eventId || !/^[0-9a-f-]{36}$/i.test(eventId)) {
    return NextResponse.json({ error: 'BAD_EVENT' }, { status: 422 });
  }

  const counts = await db().query<{ status: string; count: string }>(
    `SELECT status, COUNT(*)::text AS count
     FROM marketing.event_rsvps
     WHERE event_id = $1 AND status IN ('interested', 'going')
     GROUP BY status`,
    [eventId],
  );

  let myStatus: string | null = null;
  if (userId) {
    const my = await db().query<{ status: string }>(
      `SELECT status FROM marketing.event_rsvps
       WHERE user_id = $1 AND event_id = $2`,
      [userId, eventId],
    );
    myStatus = my.rows[0]?.status ?? null;
  }

  return NextResponse.json({
    counts: Object.fromEntries(counts.rows.map((c) => [c.status, Number(c.count)])),
    myStatus,
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BAD_INPUT', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  await db().query(
    `INSERT INTO marketing.event_rsvps (user_id, event_id, status, is_public)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, event_id)
     DO UPDATE SET status = $3, is_public = $4, updated_at = NOW()`,
    [userId, parsed.data.eventId, parsed.data.status, parsed.data.isPublic],
  );

  return NextResponse.json({ ok: true, status: parsed.data.status });
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const eventId = (body as { eventId?: string }).eventId;
  if (!eventId || !/^[0-9a-f-]{36}$/i.test(eventId)) {
    return NextResponse.json({ error: 'BAD_EVENT' }, { status: 422 });
  }

  await db().query(
    `DELETE FROM marketing.event_rsvps WHERE user_id = $1 AND event_id = $2`,
    [userId, eventId],
  );

  return NextResponse.json({ ok: true });
}
