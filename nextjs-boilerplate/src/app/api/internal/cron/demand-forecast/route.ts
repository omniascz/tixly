/**
 * POST /api/internal/cron/demand-forecast
 *
 * Cron endpoint — každých 6 hodin přepočítá demand forecast pro všechny aktivní eventy.
 *
 * Algoritmus:
 *  1. Najde published eventy co jsou v budoucnosti (do 90 dní) nebo probíhají
 *  2. Pro každý spočítá: tickets_sold, tickets_total, pct_sold, velocity_7d/1d
 *  3. Forecast: lineární extrapolace z velocity_7d na zbývající dny
 *  4. Demand score 0–100 na základě pct_sold + velocity trend
 *  5. Recommendation: raise_price / lower_price / flash_sale / hold / last_minute
 *  6. Uloží snapshot do analytics.demand_forecasts
 *  7. Zkontroluje yield_rules a pokud threshold překročen → uloží triggered_at
 *
 * Auth: x-internal-token
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { timingSafeEqual } from 'crypto';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

interface EventRow {
  id: string;
  title: string;
  date_start: string;
  promoter_id: string;
}

interface SalesRow {
  event_id: string;
  total_qty: number;
  sold_qty: number;
  sold_7d: number;
  sold_1d: number;
}

function computeScore(pctSold: number, velocity7d: number, daysToEvent: number): number {
  // Base score from pct sold (0–70 points)
  const baseScore = Math.min(70, pctSold * 0.7);
  // Velocity bonus: normalize to 0–30 points (5+ tickets/day = full bonus)
  const velBonus = Math.min(30, (velocity7d / 5) * 30);
  // Urgency: events in <7 days get a boost
  const urgencyBoost = daysToEvent <= 7 ? 10 : daysToEvent <= 14 ? 5 : 0;
  return Math.min(100, baseScore + velBonus + urgencyBoost);
}

function computeRecommendation(
  pctSold: number,
  demandScore: number,
  daysToEvent: number,
): 'raise_price' | 'lower_price' | 'flash_sale' | 'hold' | 'last_minute' {
  if (daysToEvent <= 3 && pctSold < 70) return 'last_minute';
  if (demandScore >= 80 && pctSold >= 60) return 'raise_price';
  if (demandScore <= 20 && daysToEvent > 14) return 'lower_price';
  if (pctSold < 50 && daysToEvent <= 7) return 'flash_sale';
  return 'hold';
}

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {
    const token = req.headers.get('x-internal-token') ?? '';
    const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
    if (!expected || !safeEqual(token, expected)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Fetch upcoming published events (within 90 days)
    const events = await db().query<EventRow>(
      `SELECT id, title, date_start, promoter_id
       FROM catalog.events
       WHERE status = 'published'
         AND date_start BETWEEN NOW() - INTERVAL '1 day' AND NOW() + INTERVAL '90 days'
       ORDER BY date_start`,
    );

    if (events.rows.length === 0) {
      return NextResponse.json({ ok: true, processed: 0, failed: 0, errors: [], message: 'No upcoming events' });
    }

    const eventIds = events.rows.map((e) => e.id);

    // Aggregate sales data per event
    const salesData = await db().query<SalesRow>(
      `SELECT
         tt.event_id,
         SUM(tt.total_qty)::int AS total_qty,
         SUM(tt.total_qty - tt.remaining_qty)::int AS sold_qty,
         COALESCE(SUM(recent7.cnt), 0)::int AS sold_7d,
         COALESCE(SUM(recent1.cnt), 0)::int AS sold_1d
       FROM catalog.ticket_types tt
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS cnt
         FROM orders.order_items oi
         JOIN orders.orders o ON o.id = oi.order_id
         WHERE oi.ticket_type_id = tt.id
           AND o.status = 'paid'
           AND o.created_at >= NOW() - INTERVAL '7 days'
       ) recent7 ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS cnt
         FROM orders.order_items oi
         JOIN orders.orders o ON o.id = oi.order_id
         WHERE oi.ticket_type_id = tt.id
           AND o.status = 'paid'
           AND o.created_at >= NOW() - INTERVAL '1 day'
       ) recent1 ON true
       WHERE tt.event_id = ANY($1)
       GROUP BY tt.event_id`,
      [eventIds],
    );

    const salesByEventId = new Map<string, SalesRow>();
    for (const row of salesData.rows) {
      salesByEventId.set(row.event_id, row);
    }

    let processed = 0;
    const errors: { eventId: string; error: string }[] = [];

    for (const event of events.rows) {
      try {
        const sales = salesByEventId.get(event.id);
        if (!sales || sales.total_qty === 0) continue;

        const now = new Date();
        const startAt = new Date(event.date_start);
        const daysToEvent = Math.max(0, Math.round((startAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
        const pctSold = (sales.sold_qty / sales.total_qty) * 100;
        const velocity7d = sales.sold_7d / 7;
        const velocity1d = sales.sold_1d;

        // Forecast: extrapolate from velocity_7d for remaining days
        const forecastAdditional = Math.round(velocity7d * daysToEvent);
        const forecastSold = Math.min(sales.total_qty, sales.sold_qty + forecastAdditional);
        const forecastPct = (forecastSold / sales.total_qty) * 100;

        const demandScore = computeScore(pctSold, velocity7d, daysToEvent);
        const recommendation = computeRecommendation(pctSold, demandScore, daysToEvent);

        await db().query(
          `INSERT INTO analytics.demand_forecasts
             (event_id, days_to_event, tickets_sold, tickets_total, pct_sold,
              velocity_7d, velocity_1d, forecast_sold, forecast_pct, demand_score, recommendation)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            event.id,
            daysToEvent,
            sales.sold_qty,
            sales.total_qty,
            pctSold.toFixed(2),
            velocity7d.toFixed(2),
            velocity1d,
            forecastSold,
            forecastPct.toFixed(2),
            demandScore.toFixed(2),
            recommendation,
          ],
        );

        // Check yield rules for this event
        const rules = await db().query<{
          id: string;
          pct_threshold: string;
          action: string;
          triggered_at: string | null;
        }>(
          `SELECT id, pct_threshold, action, triggered_at
           FROM analytics.yield_rules
           WHERE event_id = $1 AND is_active = true`,
          [event.id],
        );

        for (const rule of rules.rows) {
          const threshold = parseFloat(rule.pct_threshold);
          if (pctSold >= threshold && rule.triggered_at === null) {
            await db().query(
              `UPDATE analytics.yield_rules SET triggered_at = NOW() WHERE id = $1`,
              [rule.id],
            );
          }
        }

        processed++;
      } catch (err) {
        errors.push({ eventId: event.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return NextResponse.json({
      // R-46: driv `ok: true` natvrdo, i kdyz `errors` neprazdne — porusovalo
      // kontrakt C2. Vypnute joby do C2 auditu nespadaly, takze to proklouzlo.
      ok: errors.length === 0,
      failed: errors.length,
      processed,
      total: events.rows.length,
      errors,
    });
  });
}
