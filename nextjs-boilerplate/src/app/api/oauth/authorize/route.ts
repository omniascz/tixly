/**
 * POST /api/oauth/authorize
 *
 * Internal endpoint — volaný z ConsentForm po user approve.
 * Issues auth code, který se vrátí v redirect_uri jako query param.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { Pool } from 'pg';
import { z } from 'zod';
import { verifyToken } from '@/lib/auth';
import { issueAuthCode } from '@/lib/oauth/flow';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const schema = z.object({
  clientPkId: z.string().uuid(),
  redirectUri: z.string().url(),
  scopes: z.array(z.string()).min(1),
  codeChallenge: z.string().optional(),
  codeChallengeMethod: z.enum(['S256', 'plain']).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const cookieStore = await cookies();
  const token = cookieStore.get('session_jwt')?.value;
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let userId = '';
  try {
    const payload = await verifyToken(token);
    userId = (payload.sub as string) ?? '';
  } catch {
    return NextResponse.json({ error: 'invalid_session' }, { status: 401 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  // Resolve user's promoter (if any)
  const promoter = await db().query<{ promoter_id: string }>(
    `SELECT promoter_id FROM platform.promoter_members WHERE user_id = $1 AND status = 'active' LIMIT 1`,
    [userId],
  );

  // Validate client + redirect_uri whitelist
  const client = await db().query<{ redirect_uris: string[]; allowed_scopes: string[] }>(
    `SELECT redirect_uris, allowed_scopes FROM b2b.oauth_clients WHERE id = $1 AND status = 'active'`,
    [parsed.data.clientPkId],
  );
  if (client.rows.length === 0) return NextResponse.json({ error: 'invalid_client' }, { status: 400 });
  if (!client.rows[0].redirect_uris.includes(parsed.data.redirectUri)) {
    return NextResponse.json({ error: 'invalid_redirect_uri' }, { status: 400 });
  }
  const allowed = parsed.data.scopes.filter((s) =>
    client.rows[0].allowed_scopes.includes(s) || client.rows[0].allowed_scopes.includes('*'),
  );
  if (allowed.length === 0) return NextResponse.json({ error: 'invalid_scope' }, { status: 400 });

  const { code } = await issueAuthCode({
    clientPkId: parsed.data.clientPkId,
    userId,
    promoterId: promoter.rows[0]?.promoter_id ?? null,
    redirectUri: parsed.data.redirectUri,
    scopes: allowed,
    codeChallenge: parsed.data.codeChallenge,
    codeChallengeMethod: parsed.data.codeChallengeMethod,
  });

  return NextResponse.json({ code });
}
