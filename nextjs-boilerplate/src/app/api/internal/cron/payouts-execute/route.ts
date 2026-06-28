/**
 * POST /api/internal/cron/payouts-execute
 *
 * Execution step after payouts-auto-settle.
 * Picks up all 'pending' payout records and sends the money via:
 *   - Wise: SEPA Credit Transfer / SWIFT (EU/international)
 *   - PayPal Payouts: if promoter.payout_method = 'paypal'
 *   - FIO manual note: CZK domestic (operator initiates from FIO internet banking)
 *
 * Scheduling: Runs Tuesday–Friday 8 AM (1 day after settle cron creates records).
 * Schedule in vercel.json cron: "0 8 * * 2-5"
 *
 * Security: x-internal-token header required.
 *
 * Idempotent: uses external_payout_id + payout UUID as idempotency keys.
 * Safe to re-run — already paid payouts are skipped (status != 'pending').
 *
 * Max batch: 50 payouts per run (rate limits on Wise/PayPal). Scheduled cron
 * runs daily so backlog clears within days.
 */

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { fetchPendingPayouts, executePayout } from '@/lib/payouts/executor';

export const dynamic = 'force-dynamic';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest): Promise<Response> {
  const token = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const batchSize = Number(new URL(req.url).searchParams.get('limit') ?? '50');
  const pending = await fetchPendingPayouts(Math.min(batchSize, 100));

  if (pending.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, message: 'No pending payouts' });
  }

  const results = await Promise.allSettled(pending.map((row) => executePayout(row)));

  let paid = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      if (result.value.status === 'paid') paid++;
      else if (result.value.status === 'skipped') skipped++;
      else {
        failed++;
        if (result.value.reason) errors.push(`${result.value.payoutId}: ${result.value.reason}`);
      }
    } else {
      failed++;
      errors.push(String(result.reason));
    }
  }

  console.info(`[payouts-execute] batch=${pending.length} paid=${paid} skipped=${skipped} failed=${failed}`);

  return NextResponse.json({
    ok: true,
    processed: pending.length,
    paid,
    skipped,
    failed,
    errors: errors.length > 0 ? errors : undefined,
  });
}
