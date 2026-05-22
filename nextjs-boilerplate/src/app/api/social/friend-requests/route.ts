/**
 * GET /api/social/friend-requests — list pending requests (incoming + outgoing)
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function GET(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const incoming = await db().query<{
    id: string;
    from_user_id: string;
    email: string;
    name: string | null;
    message: string | null;
    created_at: string;
  }>(
    `SELECT r.id, r.from_user_id, u.email, u.name, r.message, r.created_at::text
       FROM social_graph.friend_requests r
       JOIN identity.users u ON u.id = r.from_user_id
      WHERE r.to_user_id = $1 AND r.status = 'pending'
      ORDER BY r.created_at DESC
      LIMIT 100`,
    [userId],
  );

  const outgoing = await db().query<{
    id: string;
    to_user_id: string;
    email: string;
    name: string | null;
    created_at: string;
  }>(
    `SELECT r.id, r.to_user_id, u.email, u.name, r.created_at::text
       FROM social_graph.friend_requests r
       JOIN identity.users u ON u.id = r.to_user_id
      WHERE r.from_user_id = $1 AND r.status = 'pending'
      ORDER BY r.created_at DESC
      LIMIT 100`,
    [userId],
  );

  return NextResponse.json({
    incoming: incoming.rows.map((r) => ({
      requestId: r.id,
      fromUserId: r.from_user_id,
      fromEmail: r.email,
      fromName: r.name,
      message: r.message,
      sentAt: r.created_at,
    })),
    outgoing: outgoing.rows.map((r) => ({
      requestId: r.id,
      toUserId: r.to_user_id,
      toEmail: r.email,
      toName: r.name,
      sentAt: r.created_at,
    })),
  });
}
