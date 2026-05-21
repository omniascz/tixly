/**
 * POST /api/v3/presence/sign-in
 *
 * Presence SDK — "Sign in with Tixly" v 3rd party app.
 *
 * Body: { sessionToken } — krátkodobý session ID z OAuth user-flow
 * Vrátí: user profile + session token pro partner app
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import crypto from 'node:crypto';
import { requireApiAuth, rateLimitCheck } from '@/lib/oauth/guard';
import { hashSecret } from '@/lib/oauth/flow';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireApiAuth(req);
  if (!auth.ok) return auth.response;

  if (auth.ctx.type !== 'oauth' || !auth.ctx.userId || !auth.ctx.clientPkId) {
    return NextResponse.json({
      error: 'oauth_user_context_required',
    }, { status: 403 });
  }

  const rl = await rateLimitCheck(auth.ctx, '/api/v3/presence/sign-in', 'POST');
  if (!rl.ok) return rl.response;

  const u = await db().query<{
    id: string; email: string; first_name: string | null; last_name: string | null;
  }>(
    `SELECT id, email, first_name, last_name FROM identity.users WHERE id = $1`,
    [auth.ctx.userId],
  );

  if (u.rows.length === 0) return NextResponse.json({ error: 'user_not_found' }, { status: 404 });

  // Issue presence session
  const sessionToken = `ps_${crypto.randomBytes(32).toString('hex')}`;
  await db().query(
    `INSERT INTO identity.presence_sessions
       (client_id, user_id, session_token_hash, user_agent, ip_hash)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      auth.ctx.clientPkId, auth.ctx.userId,
      hashSecret(sessionToken),
      req.headers.get('user-agent') ?? null,
      req.headers.get('x-forwarded-for')?.split(',')[0]
        ? crypto.createHash('sha256').update(req.headers.get('x-forwarded-for')!.split(',')[0]).digest('hex').slice(0, 32)
        : null,
    ],
  );

  return NextResponse.json({
    session_token: sessionToken,
    expires_in: 86400, // 24h
    profile: {
      user_id: u.rows[0].id,
      email: u.rows[0].email,
      first_name: u.rows[0].first_name,
      last_name: u.rows[0].last_name,
    },
  });
}
