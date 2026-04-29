/**
 * GET  /api/platform/verifications?status=pending — queue pro platform admina
 * POST /api/platform/verifications/[id] — approve / reject
 *
 * Note: skip pro promotéra — verification check pro celou platformu řeší master admin
 * (jednotná legitimace ISIC, senior pass, atd. nejsou per-promoter).
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePlatformAdmin } from '@/lib/platform-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function GET(req: NextRequest): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const status = req.nextUrl.searchParams.get('status') ?? 'pending';
  const r = await db().query<{
    id: string;
    type: string;
    status: string;
    proof_url: string;
    created_at: string;
    user_email: string;
    user_name: string | null;
  }>(
    `SELECT v.id, v.type, v.status, v.proof_url, v.created_at,
            u.email AS user_email, u.name AS user_name
     FROM identity.discount_verifications v
     JOIN identity.users u ON u.id = v.user_id
     WHERE v.status = $1
     ORDER BY v.created_at ASC
     LIMIT 200`,
    [status],
  );
  return NextResponse.json({ verifications: r.rows });
}
