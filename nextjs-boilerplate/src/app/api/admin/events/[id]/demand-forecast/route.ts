/**
 * GET  /api/admin/events/[id]/demand-forecast  — latest forecast for event
 * POST /api/admin/events/[id]/demand-forecast  — compute & store new forecast
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';

interface ForecastRow {
  id: string;
  computed_at: string;
  days_to_event: number;
  sold_pct: number;
  velocity_per_day: number;
  projected_final_pct: number | null;
  recommended_price_halire: number | null;
  price_change_reason: string | null;
  auto_applied: boolean;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const owns = await db().query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2) AS exists`,
      [params.id, promoter.promoterId],
    );
    if (!owns.rows[0]?.exists) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const res = await db().query<ForecastRow>(
      `SELECT id, computed_at::text, days_to_event, sold_pct, velocity_per_day,
              projected_final_pct, recommended_price_halire, price_change_reason, auto_applied
         FROM analytics.demand_forecasts
        WHERE event_id = $1
        ORDER BY computed_at DESC
        LIMIT 1`,
      [params.id],
    );
    return NextResponse.json({ forecast: res.rows[0] ?? null });
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_promoter_id = '${promoter.promoterId}'`);
      await client.query(`SET LOCAL app.current_user_id = '${promoter.userId}'`);
      await client.query(`SET LOCAL app.is_platform_admin = 'true'`);

      const evRes = await client.query<{
        id: string;
        date_start: string;
        created_at: string;
      }>(
        `SELECT id, date_start::text, created_at::text
           FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
        [params.id, promoter.promoterId],
      );
      if (!evRes.rows[0]) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
      }
      const ev = evRes.rows[0];

      // Count sold tickets
      const soldRes = await client.query<{ sold_count: string; total_capacity: string }>(
        `SELECT
           COALESCE(SUM(oi.quantity), 0)::text AS sold_count,
           (SELECT COALESCE(SUM(tt.total_qty), 1)
              FROM catalog.ticket_types tt
             WHERE tt.event_id = $1 AND tt.active = true)::text AS total_capacity
         FROM orders.orders o
         JOIN orders.order_items oi ON oi.order_id = o.id
        WHERE o.event_id = $1 AND o.status IN ('paid', 'completed')`,
        [params.id],
      );
      const soldCount = Number(soldRes.rows[0]?.sold_count ?? 0);
      const totalCapacity = Math.max(Number(soldRes.rows[0]?.total_capacity ?? 1), 1);

      const soldPct = (soldCount / totalCapacity) * 100;

      // Days since event was created (capped at 1 to avoid div/0)
      const dateCreated = new Date(ev.created_at);
      const daysSinceCreated = Math.max(
        (Date.now() - dateCreated.getTime()) / (1000 * 60 * 60 * 24),
        1,
      );
      const velocityPerDay = soldCount / daysSinceCreated;

      const dateStart = new Date(ev.date_start);
      const daysToEvent = Math.max(
        Math.floor((dateStart.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
        0,
      );

      const projectedFinalPct = Math.min(
        soldPct + (velocityPerDay * daysToEvent / totalCapacity) * 100,
        100,
      );

      // Get current base price of default ticket type
      const priceRes = await client.query<{ base_price: number; id: string }>(
        `SELECT base_price, id FROM catalog.ticket_types
          WHERE event_id = $1 AND active = true
          ORDER BY sort_order, created_at
          LIMIT 1`,
        [params.id],
      );
      const currentPrice = priceRes.rows[0]?.base_price ?? 0;

      let recommendedPriceHalire: number | null = null;
      let priceChangeReason: string | null = null;

      if (currentPrice > 0) {
        if (projectedFinalPct > 95) {
          recommendedPriceHalire = Math.round(currentPrice * 1.15);
          priceChangeReason = 'Vysoká poptávka — projekce naznačuje vyprodání, cena +15 %';
        } else if (projectedFinalPct > 80) {
          recommendedPriceHalire = currentPrice;
          priceChangeReason = 'Dobrý zájem — cena zůstává';
        } else if (projectedFinalPct < 30) {
          recommendedPriceHalire = Math.round(currentPrice * 0.80);
          priceChangeReason = 'Pomalý prodej — projekce pod 30 %, cena −20 %';
        } else if (projectedFinalPct < 50) {
          recommendedPriceHalire = Math.round(currentPrice * 0.90);
          priceChangeReason = 'Mírně pomalý prodej — projekce pod 50 %, cena −10 %';
        } else {
          recommendedPriceHalire = currentPrice;
          priceChangeReason = 'Standardní tempo prodeje';
        }
      }

      const insRes = await client.query<ForecastRow>(
        `INSERT INTO analytics.demand_forecasts
           (event_id, days_to_event, sold_pct, velocity_per_day, projected_final_pct,
            recommended_price_halire, price_change_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, computed_at::text, days_to_event, sold_pct, velocity_per_day,
                   projected_final_pct, recommended_price_halire, price_change_reason, auto_applied`,
        [
          params.id,
          daysToEvent,
          soldPct.toFixed(2),
          velocityPerDay.toFixed(2),
          projectedFinalPct.toFixed(2),
          recommendedPriceHalire,
          priceChangeReason,
        ],
      );

      await client.query('COMMIT');
      return NextResponse.json({ forecast: insRes.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error('[POST /demand-forecast]', err);
      return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
