/**
 * POST   /api/social/friend-requests/[id]  body { action: 'accept' | 'decline' }
 * DELETE /api/social/friend-requests/[id]  — cancel (jen výchozí uživatel)
 *
 * Accept → insert do friendships (canonical user_a < user_b), mark request accepted.
 * Decline → status='declined'.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const actionSchema = z.object({
  action: z.enum(['accept', 'decline']),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_BODY', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    const r = await client.query<{
      from_user_id: string;
      to_user_id: string;
      status: string;
    }>(
      `SELECT from_user_id, to_user_id, status
         FROM social_graph.friend_requests
        WHERE id = $1
        FOR UPDATE`,
      [params.id],
    );
    if (r.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    const req_ = r.rows[0];
    if (req_.to_user_id !== userId) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'FORBIDDEN', message: 'Pouze příjemce může přijmout/odmítnout.' },
        { status: 403 },
      );
    }
    if (req_.status !== 'pending') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'NOT_PENDING', status: req_.status },
        { status: 409 },
      );
    }

    if (parsed.data.action === 'decline') {
      await client.query(
        `UPDATE social_graph.friend_requests
            SET status = 'declined', responded_at = NOW()
          WHERE id = $1`,
        [params.id],
      );
      await client.query('COMMIT');
      return NextResponse.json({ ok: true, status: 'declined' });
    }

    // Accept → insert friendship (canonical) + mark request
    const [a, b] = [req_.from_user_id, req_.to_user_id].sort();
    await client.query(
      `INSERT INTO social_graph.friendships (user_a, user_b)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [a, b],
    );
    await client.query(
      `UPDATE social_graph.friend_requests
          SET status = 'accepted', responded_at = NOW()
        WHERE id = $1`,
      [params.id],
    );

    await client.query('COMMIT');
    return NextResponse.json({ ok: true, status: 'accepted' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[POST friend-requests/[id]]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const r = await db().query<{ from_user_id: string; status: string }>(
    `UPDATE social_graph.friend_requests
        SET status = 'cancelled', responded_at = NOW()
      WHERE id = $1 AND from_user_id = $2 AND status = 'pending'
      RETURNING from_user_id, status`,
    [params.id, userId],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND_OR_NOT_OWNED' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, status: 'cancelled' });
}
