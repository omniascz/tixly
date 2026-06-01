/**
 * GET /api/v3/users/me
 *
 * Eventbrite-style "current user" endpoint.
 * Auth: OAuth Bearer token only (vyžaduje user context).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithUserContext } from '@/lib/db/rls-pool';
import { requireApiAuth, rateLimitCheck } from '@/lib/oauth/guard';

export async function GET(req: NextRequest): Promise<Response> {
  const auth = await requireApiAuth(req);
  if (!auth.ok) return auth.response;

  if (auth.ctx.type !== 'oauth' || !auth.ctx.userId) {
    return NextResponse.json({
      error: 'requires_oauth_user_context',
      message: 'Tento endpoint je dostupný jen přes OAuth access_token s user context, ne API key.',
    }, { status: 403 });
  }
  const userId = auth.ctx.userId;

  const rl = await rateLimitCheck(auth.ctx, '/api/v3/users/me', 'GET');
  if (!rl.ok) return rl.response;

  return runWithUserContext(userId, async () => {
    const u = await db().query<{
      id: string; email: string; first_name: string | null; last_name: string | null;
      name: string | null; created_at: string;
    }>(
      `SELECT id, email, first_name, last_name, name, created_at::text
         FROM identity.users
        WHERE id = $1`,
      [userId],
    );

    if (u.rows.length === 0) return NextResponse.json({ error: 'user_not_found' }, { status: 404 });

    return NextResponse.json({
      id: u.rows[0].id,
      name: u.rows[0].name,
      first_name: u.rows[0].first_name,
      last_name: u.rows[0].last_name,
      emails: [{ email: u.rows[0].email, verified: true, primary: true }],
      created: u.rows[0].created_at,
      organization_id: auth.ctx.promoterId,
    });
  });
}
