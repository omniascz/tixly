import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../lib/service-container.js';
import { materializeShifts } from '../../../../../../services/recurring-shifts.service.js';

function requireCronSecret(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true;
  return request.headers.get('x-cron-secret') === expected;
}

/**
 * Cron entrypoint: materialize 60 days ahead for every promoter that has
 * at least one active recurring template.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!requireCronSecret(request)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  try {
    const deps = getServiceDeps();
    const now = new Date();
    const to = new Date(now.getTime() + 60 * 24 * 3600_000);

    const promoters = await deps.db.query<{ promoter_id: string }>(
      `SELECT DISTINCT promoter_id FROM platform.recurring_shift_templates
       WHERE is_active = TRUE`,
    );

    const results: Array<{ promoterId: string; created: number; skipped: number }> = [];
    for (const p of promoters) {
      const r = await materializeShifts(p.promoter_id, now, to, deps);
      results.push({ promoterId: p.promoter_id, ...r });
    }
    return NextResponse.json({ results }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: (err as Error).message },
      { status: 500 },
    );
  }
}
