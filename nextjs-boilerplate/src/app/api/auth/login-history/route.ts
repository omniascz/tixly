/**
 * GET /api/auth/login-history — last 50 login attempts (success + failed)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';


export async function GET(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
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

  });
}
