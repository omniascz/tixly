import { NextRequest, NextResponse } from 'next/server';
import { InsuranceService } from '../../../../../../../services/insurance.service';
import { getDbAdapter } from '../../../../../../../lib/db-adapter';

/**
 * POST /api/admin/insurance/cron/process-payouts
 *
 * Batch cron job — iterates every approved claim whose payout_at is still NULL
 * and marks it paid out. Run hourly. Also sweeps stale active policies past
 * their claim deadline and transitions them to 'expired'.
 *
 * Protected by shared secret `CRON_SECRET` header.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 500 },
    );
  }
  if (request.headers.get('x-cron-secret') !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getDbAdapter();
    const payouts = await InsuranceService.processPendingPayouts('cron', db);
    const expiry = await InsuranceService.expireStalePolicies(db);
    return NextResponse.json({
      payoutsProcessed: payouts.processed,
      policiesExpired: expiry.expired,
    });
  } catch (err) {
    console.error('[cron process-payouts]', err);
    return NextResponse.json(
      { error: 'InternalServerError' },
      { status: 500 },
    );
  }
}
