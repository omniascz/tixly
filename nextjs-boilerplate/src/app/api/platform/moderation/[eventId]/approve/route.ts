import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePlatformAdmin } from '@/lib/platform-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { eventId: string } },
): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE catalog.events
         SET status = 'published', updated_at = NOW()
       WHERE id = $1 AND status IN ('pending_review', 'flagged')
       RETURNING id`,
      [params.eventId],
    );
    if (upd.rowCount === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Event not in review state' }, { status: 409 });
    }
    await client.query(
      `INSERT INTO audit.event_moderation_log
         (event_id, actor_user_id, actor_type, decision, reason)
       VALUES ($1, $2, 'human', 'approved', 'Manuálně schváleno master adminem')`,
      [params.eventId, admin.userId],
    );
    await client.query('COMMIT');
    return NextResponse.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[moderation/approve]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  } finally {
    client.release();
  }
}
