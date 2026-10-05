import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { isCronAuthorized } from '@/lib/security/cron-auth';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

interface RuleRow {
  rule_id: string;
  event_id: string;
  promoter_id: string;
  event_title: string;
  date_start: string;
  hours_before: number;
  min_occupancy_pct: number;
  discount_pct: number;
}

interface CapacityRow {
  rem: string;
  sold: string;
}

async function runCheck(promoterId: string | null): Promise<{ checked: number; triggered: number; log: string[] }> {
  const promoterFilter = promoterId
    ? `AND e.promoter_id = $2`
    : '';
  const queryArgs: unknown[] = [new Date().toISOString()];
  if (promoterId) queryArgs.push(promoterId);

  const rules = await db().query<RuleRow>(
    `SELECT lr.id AS rule_id,
            lr.event_id,
            e.promoter_id,
            e.title AS event_title,
            e.date_start,
            lr.hours_before,
            lr.min_occupancy_pct,
            lr.discount_pct
     FROM catalog.lastminute_rules lr
     JOIN catalog.events e ON e.id = lr.event_id
     WHERE lr.is_active = true
       AND lr.triggered_at IS NULL
       AND e.date_start > $1
       AND e.date_start <= ($1::timestamptz + (lr.hours_before + 1) * interval '1 hour')
       ${promoterFilter}`,
    queryArgs,
  );

  let triggered = 0;
  const log: string[] = [];

  for (const rule of rules.rows) {
    const cap = await db().query<CapacityRow>(
      `SELECT
         COALESCE(SUM(tt.remaining_qty), 0) AS rem,
         COUNT(oi.id) AS sold
       FROM catalog.ticket_types tt
       LEFT JOIN orders.order_items oi ON oi.ticket_type_id = tt.id
         AND EXISTS (
           SELECT 1 FROM orders.orders o
           WHERE o.id = oi.order_id AND o.status = 'paid'
         )
       WHERE tt.event_id = $1`,
      [rule.event_id],
    );

    const rem = Number(cap.rows[0]?.rem ?? 0);
    const sold = Number(cap.rows[0]?.sold ?? 0);
    const total = rem + sold;

    if (total === 0) continue;

    const occupancyPct = (sold / total) * 100;

    if (occupancyPct >= rule.min_occupancy_pct) continue;

    const priceResult = await db().query<{ base_price: number; id: string }>(
      `SELECT id, base_price FROM catalog.ticket_types
       WHERE event_id = $1 AND base_price > 0`,
      [rule.event_id],
    );

    if (priceResult.rows.length === 0) continue;

    const sampleOriginal = priceResult.rows[0].base_price;
    const sampleNew = Math.round(sampleOriginal * (1 - rule.discount_pct / 100));

    await db().query(
      `UPDATE catalog.ticket_types
       SET base_price = ROUND(base_price * (1 - $1::numeric / 100))
       WHERE event_id = $2 AND base_price > 0`,
      [rule.discount_pct, rule.event_id],
    );

    await db().query(
      `UPDATE catalog.lastminute_rules
       SET triggered_at = NOW()
       WHERE id = $1`,
      [rule.rule_id],
    );

    triggered++;
    log.push(
      `Last-minute sleva aktivována pro event "${rule.event_title}": -${rule.discount_pct}% → nová cena ${(sampleNew / 100).toLocaleString('cs-CZ')} Kč (bylo ${(sampleOriginal / 100).toLocaleString('cs-CZ')} Kč). Obsazenost: ${occupancyPct.toFixed(1)} % < ${rule.min_occupancy_pct} %.`,
    );
  }

  return { checked: rules.rows.length, triggered, log };
}

// Kolo 10 / krok 3: Vercel cron volá GET (dřív jen POST → 405, cron nikdy neběžel).
// Ověření tajemstvím cronu (Authorization: Bearer CRON_SECRET), kontrola všech pořadatelů v servisním kontextu.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  return runWithServiceContext(async () => NextResponse.json(await runCheck(null)));
}

export async function POST(req: NextRequest): Promise<Response> {
  const internalToken = req.headers.get('x-internal-token') ?? '';
  const expectedToken = process.env.INTERNAL_SERVICE_TOKEN ?? '';

  if (expectedToken && safeEqual(internalToken, expectedToken)) {
    const result = await runCheck(null);
    return NextResponse.json(result);
  }

  return runAsActivePromoter(req, async (promoter) => {
    const result = await runCheck(promoter.promoterId);
    return NextResponse.json(result);
  });
}
