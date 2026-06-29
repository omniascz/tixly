/**
 * POST /api/internal/cron/event-payout-release
 *
 * Per-event auto-payout: for each event where auto_payout_days_after_event days
 * have elapsed since date_end (or date_start), and no event-cycle payout exists yet,
 * computes net payout and inserts a platform.payouts record (status='pending').
 *
 * Runs daily at 8am via Vercel cron (dispatch?job=event-payout-release).
 * Security: x-internal-token header must match INTERNAL_SERVICE_TOKEN.
 */

import { timingSafeEqual } from 'crypto';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveHoldback, computeHoldbackAmount } from '@/lib/payouts/holdback';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const PLATFORM_FEE_BPS = 500; // 5% default

interface QualifyingEvent {
  event_id: string;
  promoter_id: string;
  tier: number;
  holdback_pct: number | null;
  holdback_days: number | null;
  date_start: string;
  date_end: string | null;
  currency: string;
}

interface EventFinancials {
  gross: string;
  refunds: string;
  chargebacks: string;
  fee_pct_bps: string | null;
}

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {
    const token = req.headers.get('x-internal-token') ?? '';
    const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
    if (!expected || !safeEqual(token, expected)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const client = await db().connect();
    let releasedCount = 0;
    const releasedEventIds: string[] = [];

    try {
      await client.query('BEGIN');

      // Find events that qualify for auto payout
      const qualifying = await client.query<QualifyingEvent>(
        `SELECT
           e.id AS event_id,
           p.id AS promoter_id,
           p.tier,
           p.chargeback_holdback_pct AS holdback_pct,
           p.chargeback_holdback_days AS holdback_days,
           e.date_start,
           e.date_end,
           COALESCE(p.primary_currency, 'CZK') AS currency
         FROM catalog.events e
         JOIN platform.promoters p ON p.id = e.promoter_id
         WHERE p.auto_payout_days_after_event IS NOT NULL
           AND p.status = 'active'
           -- SLA deadline passed
           AND COALESCE(e.date_end, e.date_start) + (p.auto_payout_days_after_event || ' days')::interval <= NOW()
           -- Event is releasable (completion verified OR hold expired)
           AND (
             e.completion_status IN ('completed', 'no_show')
             OR e.payout_hold_until IS NULL
             OR e.payout_hold_until < NOW()
           )
           -- No event-cycle payout already created for this event
           AND NOT EXISTS (
             SELECT 1 FROM platform.payouts pw
             WHERE pw.promoter_id = p.id
               AND pw.payout_cycle = 'event'
               AND pw.period_from = e.date_start
               AND pw.period_to = COALESCE(e.date_end, e.date_start)
           )`,
      );

      for (const ev of qualifying.rows) {
        // Compute financials for this event
        const fin = await client.query<EventFinancials>(
          `SELECT
             COALESCE(SUM(o.total_amount) FILTER (WHERE o.status = 'paid'), 0)::text AS gross,
             COALESCE(SUM(o.total_amount) FILTER (WHERE o.status = 'refunded'), 0)::text AS refunds,
             COALESCE(
               (SELECT SUM(cb.amount_halire) FROM orders.chargebacks cb
                WHERE cb.promoter_id = $1
                  AND cb.holdback_applied = FALSE
                  AND cb.status IN ('needs_response', 'under_review', 'lost')
                  AND cb.created_at >= e.date_start
                  AND cb.created_at <= COALESCE(e.date_end, e.date_start) + INTERVAL '14 days'),
               0
             )::text AS chargebacks,
             pf.percentage_fee::text AS fee_pct_bps
           FROM catalog.events e
           LEFT JOIN orders.orders o ON o.event_id = e.id
           LEFT JOIN platform.fee_schedules pf
             ON pf.promoter_id = $1
            AND pf.is_active = TRUE
            AND pf.valid_from <= NOW()
            AND (pf.valid_until IS NULL OR pf.valid_until > NOW())
            AND pf.currency = $3
           WHERE e.id = $2
           GROUP BY pf.percentage_fee`,
          [ev.promoter_id, ev.event_id, ev.currency],
        );

        // Use first row (may be empty if no orders — skip)
        const row = fin.rows[0];
        if (!row) continue;

        const gross = Number(row.gross);
        if (gross === 0) continue; // nothing to pay out

        const refunds = Number(row.refunds);
        const chargebacks = Number(row.chargebacks);
        const feeBps = row.fee_pct_bps != null ? Number(row.fee_pct_bps) : PLATFORM_FEE_BPS;
        const fees = Math.floor((gross * feeBps) / 10000);

        const policy = getEffectiveHoldback(ev.tier, ev.holdback_pct, ev.holdback_days);
        const grossNet = Math.max(0, gross - refunds);
        const holdbackHalire = computeHoldbackAmount(grossNet, policy);
        const netPayout = Math.max(0, gross - refunds - chargebacks - fees - holdbackHalire);

        const periodFrom = ev.date_start;
        const periodTo = ev.date_end ?? ev.date_start;

        await client.query(
          `INSERT INTO platform.payouts
             (promoter_id, period_from, period_to, gross_revenue, platform_fees,
              refunds, chargebacks, rolling_reserve, net_payout, currency, status, payout_cycle)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', 'event')`,
          [
            ev.promoter_id,
            periodFrom,
            periodTo,
            gross,
            fees,
            refunds,
            chargebacks,
            holdbackHalire,
            netPayout,
            ev.currency,
          ],
        );

        releasedCount += 1;
        releasedEventIds.push(ev.event_id);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[event-payout-release] failed:', err);
      return NextResponse.json(
        { error: 'INTERNAL', message: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    } finally {
      client.release();
    }

    return NextResponse.json({
      ok: true,
      released: releasedCount,
      eventIds: releasedEventIds,
    });
  });
}
