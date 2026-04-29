/**
 * GET /api/auth/login-history — last 50 login attempts (success + failed)
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
    id: string;
    success: boolean;
    failure_reason: string | null;
    ip: string | null;
    user_agent: string | null;
    is_suspicious: boolean;
    suspicious_reason: string | null;
    created_at: string;
  }>(
    `SELECT id, success, failure_reason, ip, user_agent, is_suspicious, suspicious_reason, created_at
     FROM identity.login_history
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [userId],
  );
  return NextResponse.json({ entries: r.rows });
}
