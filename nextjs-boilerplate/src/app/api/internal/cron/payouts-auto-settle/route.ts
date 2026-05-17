/**
 * POST /api/internal/cron/payouts-auto-settle
 *
 * Týdenní auto-settle: pro každého promotéra spočítá net payout za uplynulý
 * týden, vytvoří záznam v platform.payouts (status='pending') a chargebacky
 * z toho týdne marknout holdback_applied=TRUE.
 *
 * Spouští se 1× týdně (pondělí 7 am).
 *
 * Bezpečnost: x-internal-token header musí odpovídat INTERNAL_SERVICE_TOKEN.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { timingSafeEqual } from 'crypto';
import { getEffectiveHoldback, computeHoldbackAmount, computeReleaseDate } from '@/lib/payouts/holdback';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const PLATFORM_FEE_BPS = 500; // 5 % default — promotér může mít fee_schedule override

interface PromoterAggRow {
  promoter_id: string;
  tier: number;
  holdback_pct: number | null;
  holdback_days: number | null;
  fee_pct_bps: number | null;
  currency: string;
  gross: string;
  refunds: string;
  chargebacks: string;
}

export async function POST(req: NextRequest): Promise<Response> {
  const token = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const client = await db().connect();
  let createdCount = 0;
  let totalNetByCurrency: Record<string, number> = {};

  try {
    await client.query('BEGIN');

    // Window: uplynulý týden (od minulého pondělí 00:00 do tohoto pondělí 00:00)
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 0 = neděle, 1 = pondělí
    const daysToMonday = (dayOfWeek + 6) % 7;
    const periodEnd = new Date(now);
    periodEnd.setUTCDate(now.getUTCDate() - daysToMonday);
    periodEnd.setUTCHours(0, 0, 0, 0);
    const periodStart = new Date(periodEnd);
    periodStart.setUTCDate(periodEnd.getUTCDate() - 7);

    // Per-promotér × currency aggregace
    const agg = await client.query<PromoterAggRow>(
      `WITH active_promoters AS (
         SELECT p.id, p.tier, p.chargeback_holdback_pct AS holdback_pct,
                p.chargeback_holdback_days AS holdback_days
         FROM platform.promoters p
         WHERE p.status = 'active'
       ),
       promoter_fee AS (
         SELECT promoter_id, currency, percentage_fee AS fee_pct_bps
         FROM platform.fee_schedules
         WHERE is_active = TRUE
           AND valid_from <= NOW()
           AND (valid_until IS NULL OR valid_until > NOW())
       )
       SELECT
         ap.id AS promoter_id,
         ap.tier,
         ap.holdback_pct,
         ap.holdback_days,
         pf.fee_pct_bps,
         COALESCE(o.currency, 'CZK') AS currency,
         COALESCE(SUM(o.total_amount) FILTER (WHERE o.status = 'paid'), 0)::text AS gross,
         COALESCE(SUM(o.total_amount) FILTER (WHERE o.status = 'refunded'), 0)::text AS refunds,
         COALESCE(
           (SELECT SUM(cb.amount_halire) FROM orders.chargebacks cb
            WHERE cb.promoter_id = ap.id
              AND cb.holdback_applied = FALSE
              AND cb.status IN ('needs_response', 'under_review', 'lost')
              AND cb.created_at >= $1 AND cb.created_at < $2),
           0
         )::text AS chargebacks
       FROM active_promoters ap
       LEFT JOIN catalog.events e ON e.promoter_id = ap.id
       LEFT JOIN orders.orders o ON o.event_id = e.id
         AND o.created_at >= $1 AND o.created_at < $2
       LEFT JOIN promoter_fee pf ON pf.promoter_id = ap.id
         AND pf.currency = COALESCE(o.currency, 'CZK')
       GROUP BY ap.id, ap.tier, ap.holdback_pct, ap.holdback_days, pf.fee_pct_bps, o.currency
       HAVING COALESCE(SUM(o.total_amount) FILTER (WHERE o.status = 'paid'), 0) > 0`,
      [periodStart.toISOString(), periodEnd.toISOString()],
    );

    for (const row of agg.rows) {
      const gross = Number(row.gross);
      const refunds = Number(row.refunds);
      const chargebacks = Number(row.chargebacks);
      const feeBps = row.fee_pct_bps ?? PLATFORM_FEE_BPS;
      const fees = Math.floor((gross * feeBps) / 10000);

      const policy = getEffectiveHoldback(row.tier, row.holdback_pct, row.holdback_days);
      const grossNet = Math.max(0, gross - refunds);
      const holdbackHalire = computeHoldbackAmount(grossNet, policy);
      const netPayout = Math.max(0, gross - refunds - chargebacks - fees - holdbackHalire);

      // INSERT payout
      const payoutRes = await client.query<{ id: string }>(
        `INSERT INTO platform.payouts
           (promoter_id, period_from, period_to, gross_revenue, platform_fees,
            refunds, chargebacks, rolling_reserve, net_payout, status, payout_cycle)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', 'weekly')
         RETURNING id`,
        [
          row.promoter_id,
          periodStart.toISOString(),
          periodEnd.toISOString(),
          gross,
          fees,
          refunds,
          chargebacks,
          holdbackHalire,
          netPayout,
        ],
      );
      const payoutId = payoutRes.rows[0]!.id;
      createdCount += 1;
      totalNetByCurrency[row.currency] = (totalNetByCurrency[row.currency] ?? 0) + netPayout;

      // INSERT rolling reserve (pokud holdback > 0)
      if (holdbackHalire > 0) {
        const releaseDate = computeReleaseDate(policy, periodEnd);
        await client.query(
          `INSERT INTO platform.rolling_reserves
             (promoter_id, payout_id, amount, release_date)
           VALUES ($1, $2, $3, $4)`,
          [row.promoter_id, payoutId, holdbackHalire, releaseDate.toISOString().slice(0, 10)],
        );
      }

      // Mark chargebacky holdback_applied=TRUE (jsou pokryté tímto settlementem)
      await client.query(
        `UPDATE orders.chargebacks
         SET holdback_applied = TRUE, updated_at = NOW()
         WHERE promoter_id = $1
           AND holdback_applied = FALSE
           AND status IN ('needs_response', 'under_review', 'lost')
           AND created_at >= $2 AND created_at < $3`,
        [row.promoter_id, periodStart.toISOString(), periodEnd.toISOString()],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[payouts-auto-settle] failed:', err);
    return NextResponse.json(
      { error: 'INTERNAL', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  } finally {
    client.release();
  }

  return NextResponse.json({
    ok: true,
    createdCount,
    totalNetByCurrency,
  });
}
