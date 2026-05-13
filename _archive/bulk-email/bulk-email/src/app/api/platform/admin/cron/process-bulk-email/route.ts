import { NextRequest, NextResponse } from 'next/server';
import { processCampaignBatch } from '../../../../../../../services/bulk-email.service.js';
import type { ServiceDeps } from '../../../../../../../lib/service-container.js';
import { getServiceDeps } from '../../../../../../../lib/service-container.js';

function requireCronSecret(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true;
  return request.headers.get('x-cron-secret') === expected;
}

export async function POST(
  request: NextRequest,
  context?: { deps?: ServiceDeps },
): Promise<NextResponse> {
  if (!requireCronSecret(request)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  const deps = context?.deps ?? getServiceDeps();
  try {
    // Find all queued or sending campaigns and process one batch each
    const rows = await deps.db.query<{ id: string }>(
      `SELECT id FROM bulk_email.campaigns
       WHERE status IN ('queued', 'sending')
       ORDER BY started_at ASC NULLS FIRST
       LIMIT 10`,
    );
    const results: Array<{ campaignId: string; processed: number; remaining: number }> = [];
    for (const row of rows) {
      const r = await processCampaignBatch(row.id, 100, deps);
      results.push({ campaignId: row.id, ...r });
    }
    return NextResponse.json({ campaigns: results }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: (err as Error).message },
      { status: 500 },
    );
  }
}
