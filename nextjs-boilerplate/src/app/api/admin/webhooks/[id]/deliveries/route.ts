/**
 * GET /api/admin/webhooks/[id]/deliveries — recent deliveries pro endpoint
 * Pagination: ?limit (max 100), ?offset, ?status (success/failed/retrying/pending)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoterNonStaff } from '@/lib/admin-auth';


export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  }

  // Verify ownership
  const own = await db().query(
    `SELECT 1 FROM reservations.webhook_endpoints
     WHERE id = $1 AND promoter_id = $2`,
    [id, promoter.promoterId],
  );
  if (own.rowCount === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const url = req.nextUrl;
  const status = url.searchParams.get('status');
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10));

  const wheres: string[] = ['endpoint_id = $1'];
  const args: unknown[] = [id];
  let p = 2;
  if (status && ['pending', 'success', 'failed', 'retrying'].includes(status)) {
    wheres.push(`status = $${p++}`);
    args.push(status);
  }
  args.push(limit, offset);

  const r = await db().query(
    `SELECT id, event_type, event_id, status, attempt_count,
            last_response_status, last_response_body, last_error,
            created_at, delivered_at, next_retry_at
     FROM reservations.webhook_deliveries
     WHERE ${wheres.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${p++} OFFSET $${p++}`,
    args,
  );
  return NextResponse.json({ items: r.rows });

  });
}
