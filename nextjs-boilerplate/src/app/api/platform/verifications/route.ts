/**
 * GET  /api/platform/verifications?status=pending — queue pro platform admina
 * POST /api/platform/verifications/[id] — approve / reject
 *
 * Note: skip pro promotéra — verification check pro celou platformu řeší master admin
 * (jednotná legitimace ISIC, senior pass, atd. nejsou per-promoter).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPlatformAdmin } from '@/lib/platform-auth';


export async function GET(req: NextRequest): Promise<Response> {
  return runAsPlatformAdmin(req, async (_admin) => {
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

  });
}
