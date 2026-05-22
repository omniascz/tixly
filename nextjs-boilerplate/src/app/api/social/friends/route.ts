/**
 * GET  /api/social/friends — list my friends (užívá social_graph.friendships)
 * POST /api/social/friends — send friend request {targetEmail} or {targetUserId}
 *
 * DACH P2-4 Social FOMO (DICE pattern).
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const requestSchema = z
  .object({
    targetEmail: z.string().email().optional(),
    targetUserId: z.string().uuid().optional(),
    message: z.string().max(300).optional(),
  })
  .refine((d) => !!d.targetEmail || !!d.targetUserId, {
    message: 'Either targetEmail or targetUserId required',
  });

export async function GET(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  // friendships table: user_a < user_b. My friends = other side of any row I'm in.
  const r = await db().query<{
    friend_id: string;
    email: string;
    name: string | null;
    created_at: string;
  }>(
    `SELECT
       CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END AS friend_id,
       u.email, u.name, f.created_at::text
     FROM social_graph.friendships f
     JOIN identity.users u
       ON u.id = (CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END)
     WHERE f.user_a = $1 OR f.user_b = $1
     ORDER BY f.created_at DESC
     LIMIT 500`,
    [userId],
  );

  return NextResponse.json({
    count: r.rows.length,
    friends: r.rows.map((row) => ({
      userId: row.friend_id,
      email: row.email,
      name: row.name,
      friendsSince: row.created_at,
    })),
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_BODY', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  // Resolve target user_id
  let targetUserId = parsed.data.targetUserId ?? null;
  if (!targetUserId && parsed.data.targetEmail) {
    const r = await db().query<{ id: string }>(
      `SELECT id FROM identity.users
        WHERE email = $1 AND anonymized_at IS NULL`,
      [parsed.data.targetEmail.toLowerCase()],
    );
    if (r.rows.length === 0) {
      return NextResponse.json(
        { error: 'USER_NOT_FOUND', message: 'Tento email není registrovaný na Tixly.' },
        { status: 404 },
      );
    }
    targetUserId = r.rows[0].id;
  }

  if (targetUserId === userId) {
    return NextResponse.json(
      { error: 'SELF_REQUEST', message: 'Nemůžeš si poslat žádost sobě.' },
      { status: 422 },
    );
  }

  // Existující friendship? canonical (user_a < user_b)
  const [a, b] = [userId, targetUserId!].sort();
  const exists = await db().query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM social_graph.friendships
        WHERE user_a = $1 AND user_b = $2
     ) AS exists`,
    [a, b],
  );
  if (exists.rows[0].exists) {
    return NextResponse.json(
      { error: 'ALREADY_FRIENDS', message: 'Už jste přátelé.' },
      { status: 409 },
    );
  }

  // Pending request existuje?
  try {
    const r = await db().query<{ id: string }>(
      `INSERT INTO social_graph.friend_requests
         (from_user_id, to_user_id, message)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [userId, targetUserId, parsed.data.message ?? null],
    );
    return NextResponse.json({ ok: true, requestId: r.rows[0].id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('idx_friend_requests_unique_pending')) {
      return NextResponse.json(
        { error: 'ALREADY_REQUESTED', message: 'Žádost už čeká na potvrzení.' },
        { status: 409 },
      );
    }
    throw err;
  }
}
