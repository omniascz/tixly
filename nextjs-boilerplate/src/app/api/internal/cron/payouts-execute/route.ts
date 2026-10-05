/**
 * POST /api/internal/cron/payouts-execute
 *
 * Execution step after payouts-auto-settle.
 * Picks up all 'pending' payout records and sends the money via:
 *   - Wise: SEPA Credit Transfer / SWIFT (EU/international)
 *   - PayPal Payouts: if promoter.payout_method = 'paypal'
 *   - FIO manual note: CZK domestic (operator initiates from FIO internet banking)
 *
 * Plánování (kolo 10): pro první ostrý provoz NENÍ naplánováno (není ve vercel.json ani v ALLOWED_JOBS dispatcheru).
 * Výplaty jsou ruční: platform admin je spouští v administraci (/api/admin/payouts/execute) a u CZK/FIO převod
 * odešle z internetového bankovnictví; výplata čeká ve stavu awaiting_manual_transfer, dokud ji admin nepotvrdí
 * (/api/platform/admin/payouts/[id]/confirm-transfer). Test: tests/fix-r10-launch-flags.test.ts (crony).
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
    return NextResponse.json({ ok: true, processed: 0, failed: 0, errors: [], message: 'No pending payouts' });
  }

  const results = await Promise.allSettled(pending.map((row) => executePayout(row)));

  // Kolo 7 (C-57): executor už nehlásí 'paid' — Wise čeká na webhook, CZK na ruční převod.
  let processing = 0;
  let awaitingManualTransfer = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      if (result.value.status === 'processing') processing++;
      else if (result.value.status === 'awaiting_manual_transfer') awaitingManualTransfer++;
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

  console.info(`[payouts-execute] batch=${pending.length} processing=${processing} awaitingManualTransfer=${awaitingManualTransfer} skipped=${skipped} failed=${failed}`);

  return NextResponse.json({
    // R-46: driv `ok: true` natvrdo vedle neprazdneho `errors`. U vyplat to
    // znamenalo, ze selhani jednotlivych plateb hlasil cron jako uspech.
    ok: errors.length === 0 && failed === 0,
    processed: pending.length,
    processing,
    awaitingManualTransfer,
    skipped,
    failed,
    errors,
  });
}
