/**
 * GET    /api/auth/sessions — list active sessions
 * DELETE /api/auth/sessions?id=X — revoke specific session
 * DELETE /api/auth/sessions?all=true — revoke all except current
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';


export async function GET(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const r = await db().query<{
    id: string;
    device: string | null;
    user_agent: string | null;
    ip: string | null;
    city: string | null;
    country: string | null;
    created_at: string;
    last_seen_at: string;
  }>(
    `SELECT id, device, user_agent, ip, city, country, created_at, last_seen_at
     FROM identity.sessions
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
     ORDER BY last_seen_at DESC`,
    [userId],
  );
  return NextResponse.json({ sessions: r.rows });

  });
}

export async function DELETE(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const all = req.nextUrl.searchParams.get('all') === 'true';
  const id = req.nextUrl.searchParams.get('id');

  if (all) {
    const r = await db().query(
      `UPDATE identity.sessions
       SET revoked_at = NOW(), revoke_reason = 'user_revoked_all'
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    return NextResponse.json({ ok: true, revokedCount: r.rowCount });
  }
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 422 });

  await db().query(
    `UPDATE identity.sessions
     SET revoked_at = NOW(), revoke_reason = 'user_revoked'
     WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return NextResponse.json({ ok: true });

  });
}
