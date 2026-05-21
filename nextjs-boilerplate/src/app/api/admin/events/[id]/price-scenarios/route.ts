/**
 * GET  /api/admin/events/[id]/price-scenarios   — list scenarios
 * POST /api/admin/events/[id]/price-scenarios   — create + model scenario
 *
 * TM Pricemaster-style price compare. Promotér modeluje "co kdyby" cena změna
 * a vidí projected revenue + conversion before applying.
 *
 * Compute model heuristics (simplified — production by chtělo ML):
 *   - price elasticity per category (default -1.2)
 *   - capacity shift: x% price increase → -1.2x% demand
 *   - lower price → higher demand, but capped by capacity
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const postSchema = z.object({
  name: z.string().min(2).max(200),
  description: z.string().max(1000).optional(),
  priceAdjustments: z.record(
    z.string(), // ticket_type_id (UUID string key)
    z.object({
      priceChangePct: z.number().min(-90).max(500), // -90% až +500%
    }),
  ),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const { id: eventId } = await params;

  const r = await db().query<{
    id: string;
    name: string;
    description: string | null;
    status: string;
    projected_revenue_halire: number | null;
    projected_sold_tickets: number | null;
    projected_conversion_pct: number | null;
    baseline_revenue_halire: number | null;
    baseline_sold_tickets: number | null;
    applied_at: string | null;
    created_at: string;
  }>(
    `SELECT id, name, description, status,
            projected_revenue_halire, projected_sold_tickets, projected_conversion_pct,
            baseline_revenue_halire, baseline_sold_tickets,
            applied_at::text, created_at::text
       FROM revenue.price_scenarios
      WHERE event_id = $1 AND promoter_id = $2
      ORDER BY created_at DESC
      LIMIT 50`,
    [eventId, promoter.promoterId],
  );

  return NextResponse.json({ scenarios: r.rows });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const { id: eventId } = await params;

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
  }

  // Verify ownership
  const ownRes = await db().query(
    `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
    [eventId, promoter.promoterId],
  );
  if (ownRes.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  // Load current ticket types
  const ticketTypesRes = await db().query<{
    id: string;
    base_price: number;
    total_qty: number;
    remaining_qty: number;
  }>(
    `SELECT id, base_price, total_qty, remaining_qty
       FROM catalog.ticket_types
      WHERE event_id = $1 AND visibility = 'public'`,
    [eventId],
  );

  // Baseline: current state
  let baselineRevenue = 0;
  let baselineSold = 0;
  for (const tt of ticketTypesRes.rows) {
    const sold = tt.total_qty - tt.remaining_qty;
    baselineSold += sold;
    baselineRevenue += sold * tt.base_price;
  }

  // Projected: aplikuj scenario s price elasticity heuristikou
  // demand_change_pct = -1.2 × price_change_pct (price elasticity -1.2 standard)
  const ELASTICITY = -1.2;
  let projectedRevenue = 0;
  let projectedSold = 0;

  for (const tt of ticketTypesRes.rows) {
    const adjustment = parsed.data.priceAdjustments[tt.id];
    const priceChangePct = adjustment?.priceChangePct ?? 0;
    const newPrice = Math.max(0, tt.base_price * (1 + priceChangePct / 100));

    // Demand projection: original sold rate + elasticity adjustment
    const soldRateBaseline = (tt.total_qty - tt.remaining_qty) / Math.max(tt.total_qty, 1);
    const demandChangePct = ELASTICITY * priceChangePct;
    const projectedSoldRate = Math.max(0, Math.min(1, soldRateBaseline * (1 + demandChangePct / 100)));
    const projectedSoldQty = Math.round(projectedSoldRate * tt.total_qty);

    projectedSold += projectedSoldQty;
    projectedRevenue += projectedSoldQty * newPrice;
  }

  const totalCapacity = ticketTypesRes.rows.reduce((s, t) => s + t.total_qty, 0);
  const projectedConversion = totalCapacity > 0 ? (projectedSold / totalCapacity) * 100 : 0;

  const r = await db().query<{ id: string }>(
    `INSERT INTO revenue.price_scenarios
       (promoter_id, event_id, name, description,
        price_adjustments, projected_revenue_halire, projected_sold_tickets,
        projected_conversion_pct, baseline_revenue_halire, baseline_sold_tickets,
        status, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, 'modeled', $11)
     RETURNING id`,
    [
      promoter.promoterId, eventId, parsed.data.name, parsed.data.description ?? null,
      JSON.stringify(parsed.data.priceAdjustments),
      Math.round(projectedRevenue), projectedSold,
      Number(projectedConversion.toFixed(2)),
      baselineRevenue, baselineSold,
      promoter.userId,
    ],
  );

  return NextResponse.json({
    id: r.rows[0].id,
    projection: {
      revenueChange: projectedRevenue - baselineRevenue,
      revenueChangePct: baselineRevenue > 0
        ? ((projectedRevenue - baselineRevenue) / baselineRevenue) * 100
        : 0,
      soldChange: projectedSold - baselineSold,
      soldChangePct: baselineSold > 0
        ? ((projectedSold - baselineSold) / baselineSold) * 100
        : 0,
      conversionPct: projectedConversion,
    },
    baseline: {
      revenue: baselineRevenue,
      sold: baselineSold,
    },
    projected: {
      revenue: Math.round(projectedRevenue),
      sold: projectedSold,
    },
  }, { status: 201 });
}
