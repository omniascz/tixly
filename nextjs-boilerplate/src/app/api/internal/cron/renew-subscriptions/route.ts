/**
 * POST /api/internal/cron/renew-subscriptions
 *
 * Cron — projde subscriptions s next_billing_at <= NOW() a:
 *   - posune current_period_start/end + next_billing_at
 *   - V produkci: charge přes Stripe; pokud fail → status='past_due'.
 *   - V demu: instant renew (mock GoPay).
 *
 * Auth: x-internal-token.
 */

import { timingSafeEqual } from 'crypto';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { NextRequest, NextResponse } from 'next/server';


function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  const token = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Find due subscriptions
  const due = await db().query<{
    id: string;
    plan_id: string;
    billing_cycle: string;
    cancel_at_period_end: boolean;
  }>(
    `SELECT s.id, s.plan_id, p.billing_cycle, s.cancel_at_period_end
     FROM subscriptions.subscriptions s
     JOIN subscriptions.plans p ON p.id = s.plan_id
     WHERE s.status = 'active'
       AND s.next_billing_at <= NOW()`,
  );

  let renewed = 0;
  let cancelled = 0;
  for (const sub of due.rows) {
    if (sub.cancel_at_period_end) {
      await db().query(
        `UPDATE subscriptions.subscriptions
         SET status = 'cancelled', cancelled_at = NOW()
         WHERE id = $1`,
        [sub.id],
      );
      cancelled += 1;
      continue;
    }
    // NOTE (ForgeMsg): production billing will charge via Stripe here; on a
    // failed charge set status='past_due' and emit the dunning trigger:
    //   await emitForgeMsg({ type: 'subscription_past_due',
    //     contact: { email: <buyer email> },
    //     payload: { renew_url, subscription_id: sub.id } }, <promoter_id>);
    // Not wired today because this cron is a mock instant-renew (no past_due path).
    // Mock renew: posuneme period
    const advanceClause =
      sub.billing_cycle === 'monthly'
        ? `NOW() + INTERVAL '1 month'`
        : `NOW() + INTERVAL '1 year'`;
    await db().query(
      `UPDATE subscriptions.subscriptions
       SET current_period_start = NOW(),
           current_period_end = ${advanceClause},
           next_billing_at = ${advanceClause}
       WHERE id = $1`,
      [sub.id],
    );
    renewed += 1;
  }

  return NextResponse.json({ ok: true, processed: due.rows.length, renewed, cancelled });

  });
}
