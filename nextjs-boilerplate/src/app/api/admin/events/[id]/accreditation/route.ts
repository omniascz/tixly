/**
 * GET   /api/admin/events/[id]/accreditation       — list žádostí (filter ?status=)
 * PATCH /api/admin/events/[id]/accreditation/[reqId]
 *
 * GET ownership: promotér vlastní event.
 * PATCH body: { action: 'approve' | 'reject' | 'cancel', rejectionReason? }
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

async function ownsEvent(eventId: string, promoterId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return false;
  const r = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM catalog.events
     WHERE id = $1 AND promoter_id = $2`,
    [eventId, promoterId],
  );
  return Number(r.rows[0]?.count ?? 0) > 0;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await ownsEvent(params.id, promoter.promoterId))) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const statusFilter = req.nextUrl.searchParams.get('status');
  const args: unknown[] = [params.id];
  let statusClause = '';
  if (statusFilter) {
    args.push(statusFilter);
    statusClause = ` AND status = $${args.length}`;
  }

  const r = await db().query(
    `SELECT id, applicant_email, applicant_name, organization, category,
            role_detail, message, status, reviewed_at, rejection_reason,
            issued_ticket_id, created_at
     FROM marketing.accreditation_requests
     WHERE event_id = $1 ${statusClause}
     ORDER BY
       CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'rejected' THEN 2 ELSE 3 END,
       created_at DESC`,
    args,
  );

  const counts = await db().query<{ status: string; count: string }>(
    `SELECT status, COUNT(*)::text AS count
     FROM marketing.accreditation_requests
     WHERE event_id = $1
     GROUP BY status`,
    [params.id],
  );

  return NextResponse.json({
    eventId: params.id,
    requests: r.rows,
    counts: Object.fromEntries(counts.rows.map((c) => [c.status, Number(c.count)])),
  });
}
