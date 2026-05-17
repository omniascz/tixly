/**
 * GET /api/admin/payouts
 *
 * Vrátí seznam výplat promotéra. Pokud žádný záznam v `platform.payouts`
 * neexistuje, dopočítá ad-hoc týdenní bucket z paid orders v posledních
 * 12 týdnech (mock pro demo). Platform fee 5 % default.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePromoter } from '@/lib/admin-auth';

const PLATFORM_FEE_BPS = 500; // 5.00 %

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface PayoutRow {
  id: string;
  period_from: string;
  period_to: string;
  gross_revenue: number;
  platform_fees: number;
  refunds: number;
  net_payout: number;
  status: string;
  paid_at: string | null;
}

interface BucketRow {
  period_start: string;
  period_end: string;
  gross: string;
  refunds: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 1) Skutečné výplaty
  const real = await db().query<PayoutRow>(
    `SELECT id, period_from, period_to, gross_revenue, platform_fees,
            refunds, net_payout, status, paid_at
     FROM platform.payouts
     WHERE promoter_id = $1
     ORDER BY period_to DESC
     LIMIT 50`,
    [promoter.promoterId],
  );

  if (real.rows.length > 0) {
    return NextResponse.json({
      source: 'real',
      payouts: real.rows.map((r) => ({
        id: r.id,
        periodStart: r.period_from,
        periodEnd: r.period_to,
        grossHalire: r.gross_revenue,
        feesHalire: r.platform_fees,
        refundsHalire: r.refunds,
        netHalire: r.net_payout,
        status: r.status,
        paidAt: r.paid_at,
      })),
    });
  }

  // 2) Ad-hoc bucket z paid orders (12 týdnů zpět). Demo režim.
  // Holdback policy per promotér (tier + override z migrace 265)
  const { getEffectiveHoldback, computeHoldbackAmount } = await import(
    '@/lib/payouts/holdback'
  );
  const promoterRes = await db().query<{
    tier: number;
    chargeback_holdback_pct: number | null;
    chargeback_holdback_days: number | null;
  }>(
    `SELECT tier, chargeback_holdback_pct, chargeback_holdback_days
     FROM platform.promoters WHERE id = $1`,
    [promoter.promoterId],
  );
  const tier = promoterRes.rows[0]?.tier ?? 1;
  const holdbackPolicy = getEffectiveHoldback(
    tier,
    promoterRes.rows[0]?.chargeback_holdback_pct ?? null,
    promoterRes.rows[0]?.chargeback_holdback_days ?? null,
  );

  // Per-currency buckets — CZ promotér může mít CZK akce, SK promotér EUR,
  // hybrid promotér oboje. Settlement musí být oddělený per měna.
  const buckets = await db().query<BucketRow & { chargebacks: string; currency: string }>(
    `WITH weeks AS (
       SELECT generate_series(
         DATE_TRUNC('week', NOW() - INTERVAL '12 weeks'),
         DATE_TRUNC('week', NOW()),
         '1 week'
       ) AS week_start
     ),
     currencies AS (
       SELECT DISTINCT COALESCE(o.currency, 'CZK') AS currency
       FROM orders.orders o
       JOIN catalog.events e ON e.id = o.event_id
       WHERE e.promoter_id = $1
       UNION SELECT 'CZK'  -- vždy zahrň CZK aby se zobrazilo i bez orders
     )
     SELECT
       w.week_start AS period_start,
       (w.week_start + INTERVAL '7 days') AS period_end,
       c.currency,
       COALESCE(SUM(o.total_amount) FILTER (WHERE o.status = 'paid' AND o.currency = c.currency), 0)::text AS gross,
       COALESCE(SUM(o.total_amount) FILTER (WHERE o.status = 'refunded' AND o.currency = c.currency), 0)::text AS refunds,
       COALESCE(
         (SELECT SUM(cb.amount_halire) FROM orders.chargebacks cb
          JOIN orders.orders co ON co.id = cb.order_id
          WHERE cb.promoter_id = $1
            AND co.currency = c.currency
            AND cb.holdback_applied = FALSE
            AND cb.status IN ('needs_response', 'under_review', 'lost')
            AND cb.created_at >= w.week_start
            AND cb.created_at < w.week_start + INTERVAL '7 days'),
         0
       )::text AS chargebacks
     FROM weeks w
     CROSS JOIN currencies c
     LEFT JOIN catalog.events e ON e.promoter_id = $1
     LEFT JOIN orders.orders o ON o.event_id = e.id
       AND o.created_at >= w.week_start
       AND o.created_at < w.week_start + INTERVAL '7 days'
       AND o.currency = c.currency
     GROUP BY w.week_start, c.currency
     ORDER BY w.week_start DESC, c.currency ASC`,
    [promoter.promoterId],
  );

  const now = new Date();
  return NextResponse.json({
    source: 'computed',
    feePercent: PLATFORM_FEE_BPS / 100,
    holdback: {
      pctBps: holdbackPolicy.pctBps,
      retentionDays: holdbackPolicy.retentionDays,
      tier,
    },
    payouts: buckets.rows
      .filter((b) => Number(b.gross) > 0 || Number(b.refunds) > 0 || Number(b.chargebacks) > 0)
      .map((b) => {
        const gross = Number(b.gross);
        const refunds = Number(b.refunds);
        const chargebacks = Number(b.chargebacks);
        const fees = Math.floor((gross * PLATFORM_FEE_BPS) / 10000);
        const grossNetOfRefunds = Math.max(0, gross - refunds);
        const holdbackHalire = computeHoldbackAmount(grossNetOfRefunds, holdbackPolicy);
        const net = Math.max(0, gross - refunds - chargebacks - fees - holdbackHalire);
        const periodEnd = new Date(b.period_end);
        return {
          id: `mock-${b.currency}-${b.period_start}`,
          periodStart: b.period_start,
          periodEnd: b.period_end,
          currency: b.currency,
          grossHalire: gross,
          feesHalire: fees,
          refundsHalire: refunds,
          chargebacksHalire: chargebacks,
          holdbackHalire,
          netHalire: net,
          status: periodEnd < now ? 'pending' : 'in_progress',
          paidAt: null,
        };
      }),
  });
}
