/**
 * GET  /api/admin/events/[id]/demand-forecast  — načte poslední forecast + yield rules
 * POST /api/admin/events/[id]/demand-forecast  — uloží/aktualizuje yield rules
 *
 * Auth: runAsActivePromoter
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithPromoterContext } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

const ruleSchema = z.object({
  pctThreshold: z.number().min(0).max(100),
  action: z.enum(['raise_price', 'lower_price', 'flash_sale', 'notify']),
  priceDeltaPct: z.number().min(-100).max(500).nullable().optional(),
  notificationEmail: z.string().email().nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
      return NextResponse.json({ error: 'INVALID_ID' }, { status: 422 });
    }

    return runWithPromoterContext(promoter.promoterId, async () => {
      const ownership = await db().query(
        `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2 LIMIT 1`,
        [params.id, promoter.promoterId],
      );
      if (ownership.rows.length === 0) {
        return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
      }

      const [forecastRes, rulesRes] = await Promise.all([
        db().query<{
          id: string;
          computed_at: string;
          days_to_event: number;
          tickets_sold: number;
          tickets_total: number;
          pct_sold: string;
          velocity_7d: string | null;
          velocity_1d: string | null;
          forecast_sold: number | null;
          forecast_pct: string | null;
          demand_score: string | null;
          recommendation: string | null;
          notes: string | null;
        }>(
          `SELECT * FROM analytics.demand_forecasts
           WHERE event_id = $1
           ORDER BY computed_at DESC
           LIMIT 30`,
          [params.id],
        ),
        db().query<{
          id: string;
          pct_threshold: string;
          action: string;
          price_delta_pct: string | null;
          notification_email: string | null;
          is_active: boolean;
          triggered_at: string | null;
          created_at: string;
        }>(
          `SELECT * FROM analytics.yield_rules
           WHERE event_id = $1
           ORDER BY pct_threshold`,
          [params.id],
        ),
      ]);

      return NextResponse.json({
        forecasts: forecastRes.rows.map((r) => ({
          ...r,
          pctSold: parseFloat(r.pct_sold),
          velocity7d: r.velocity_7d ? parseFloat(r.velocity_7d) : null,
          velocity1d: r.velocity_1d ? parseFloat(r.velocity_1d) : null,
          forecastPct: r.forecast_pct ? parseFloat(r.forecast_pct) : null,
          demandScore: r.demand_score ? parseFloat(r.demand_score) : null,
        })),
        yieldRules: rulesRes.rows.map((r) => ({
          ...r,
          pctThreshold: parseFloat(r.pct_threshold),
          priceDeltaPct: r.price_delta_pct ? parseFloat(r.price_delta_pct) : null,
        })),
      });
    });
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
      return NextResponse.json({ error: 'INVALID_ID' }, { status: 422 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
    }

    const parsed = ruleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'VALIDATION_FAILED', issues: parsed.error.issues }, { status: 422 });
    }
    const input = parsed.data;

    return runWithPromoterContext(promoter.promoterId, async () => {
      const ownership = await db().query(
        `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2 LIMIT 1`,
        [params.id, promoter.promoterId],
      );
      if (ownership.rows.length === 0) {
        return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
      }

      const r = await db().query<{ id: string }>(
        `INSERT INTO analytics.yield_rules
           (event_id, promoter_id, pct_threshold, action, price_delta_pct, notification_email, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          params.id,
          promoter.promoterId,
          input.pctThreshold,
          input.action,
          input.priceDeltaPct ?? null,
          input.notificationEmail ?? null,
          input.isActive ?? true,
        ],
      );

      return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
    });
  });
}
