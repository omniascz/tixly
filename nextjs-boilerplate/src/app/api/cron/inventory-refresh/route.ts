/**
 * GET /api/cron/inventory-refresh
 *
 * Refresh materialized view catalog.mv_event_inventory_status.
 * Spouští se á 1 minuta přes Vercel cron.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { isCronAuthorized } from '@/lib/security/cron-auth';


export async function GET(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  // Kolo 2: `x-vercel-cron` pošle kdokoli → dřív stačilo k běhu cronu bez tajemství.
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const start = Date.now();
  await db().query(`REFRESH MATERIALIZED VIEW CONCURRENTLY catalog.mv_event_inventory_status`)
    .catch(async () => {
      // Fallback non-concurrent pokud index neexistuje
      await db().query(`REFRESH MATERIALIZED VIEW catalog.mv_event_inventory_status`);
    });

  const durationMs = Date.now() - start;
  return NextResponse.json({ refreshed: true, durationMs, at: new Date().toISOString() });

  });
}
