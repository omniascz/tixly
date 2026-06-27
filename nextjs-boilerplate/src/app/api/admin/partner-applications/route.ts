/**
 * GET /api/admin/partner-applications — list applications
 * Query: ?status=pending|active|all (default: pending)
 *
 * Auth: platform admin JWT
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithPlatformAdminContext } from '@/lib/db/rls-pool';
import { requirePlatformAdmin } from '@/lib/platform-auth';

export async function GET(req: NextRequest): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return runWithPlatformAdminContext(async () => {
    const status = req.nextUrl.searchParams.get('status') ?? 'pending';
    const r = await db().query(
      `SELECT id, name, contact_email, contact_phone, website_url,
              partner_type, apply_note, status, commission_pct, applied_at, created_at
       FROM partner.partners
       WHERE ($1 = 'all' OR status = $1)
       ORDER BY applied_at DESC NULLS LAST, created_at DESC
       LIMIT 200`,
      [status],
    );
    return NextResponse.json({ applications: r.rows, total: r.rowCount });
  });
}
