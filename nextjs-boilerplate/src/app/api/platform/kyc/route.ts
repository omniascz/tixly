/**
 * GET /api/platform/kyc?status=submitted — KYC queue pro master admin
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

  const status = req.nextUrl.searchParams.get('status') ?? 'submitted';
  const r = await db().query<{
    id: string;
    name: string;
    slug: string;
    company_ico: string | null;
    company_dic: string | null;
    company_address: string | null;
    bank_account: string | null;
    kyc_status: string;
    kyc_submitted_at: string | null;
    ares_verified_at: string | null;
    ares_data: unknown;
    documents_count: number;
  }>(
    `SELECT p.id, p.name, p.slug, p.company_ico, p.company_dic, p.company_address,
            p.bank_account, p.kyc_status, p.kyc_submitted_at,
            p.ares_verified_at, p.ares_data,
            (SELECT COUNT(*)::int FROM platform.promoter_documents WHERE promoter_id = p.id) AS documents_count
     FROM platform.promoters p
     WHERE p.kyc_status = $1
     ORDER BY p.kyc_submitted_at ASC NULLS LAST
     LIMIT 100`,
    [status],
  );
  return NextResponse.json({ promoters: r.rows });
}
