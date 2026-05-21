/**
 * GET/DELETE /api/buyer/connected-apps
 *
 * Buyer vidí které 3rd party apps mají access k jeho účtu (přes OAuth).
 * DELETE ?clientId=... = revoke všech access + refresh tokens pro daný client.
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
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const r = await db().query<{
    client_id: string;
    app_name: string;
    app_description: string | null;
    app_logo_url: string | null;
    scopes: string[];
    last_used_at: string | null;
    granted_at: string;
  }>(
    `SELECT DISTINCT
       c.client_id, c.app_name, c.app_description, c.app_logo_url,
       at.scopes,
       MAX(at.last_used_at)::text AS last_used_at,
       MIN(at.created_at)::text AS granted_at
       FROM b2b.oauth_access_tokens at
       JOIN b2b.oauth_clients c ON c.id = at.client_id
      WHERE at.user_id = $1 AND at.revoked_at IS NULL
   GROUP BY c.id, c.client_id, c.app_name, c.app_description, c.app_logo_url, at.scopes
   ORDER BY MAX(at.last_used_at) DESC NULLS LAST`,
    [userId],
  );

  return NextResponse.json({ apps: r.rows });
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const clientPublicId = new URL(req.url).searchParams.get('clientId');
  if (!clientPublicId) return NextResponse.json({ error: 'CLIENT_ID_REQUIRED' }, { status: 422 });

  const cl = await db().query<{ id: string }>(
    `SELECT id FROM b2b.oauth_clients WHERE client_id = $1`,
    [clientPublicId],
  );
  if (cl.rows.length === 0) return NextResponse.json({ error: 'CLIENT_NOT_FOUND' }, { status: 404 });

  await db().query(
    `UPDATE b2b.oauth_access_tokens SET revoked_at = now()
      WHERE user_id = $1 AND client_id = $2 AND revoked_at IS NULL`,
    [userId, cl.rows[0].id],
  );
  await db().query(
    `UPDATE b2b.oauth_refresh_tokens SET revoked_at = now()
      WHERE user_id = $1 AND client_id = $2 AND revoked_at IS NULL`,
    [userId, cl.rows[0].id],
  );

  return NextResponse.json({ revoked: true });
}
