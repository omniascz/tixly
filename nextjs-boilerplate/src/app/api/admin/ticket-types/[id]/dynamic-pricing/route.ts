/**
 * GET  /api/admin/ticket-types/[id]/dynamic-pricing — current rule + computed preview
 * PUT  /api/admin/ticket-types/[id]/dynamic-pricing — upsert rule
 * DELETE                                              — remove rule (= disable dynamic pricing)
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';
import { computeDynamicPrice, refreshDynamicPrice } from '@/lib/dynamic-pricing/compute';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const schema = z.object({
  enabled: z.boolean(),
  minPriceMinor: z.number().int().min(0),
  maxPriceMinor: z.number().int().min(0),
  velocityThresholdPerHour: z.number().int().min(1).max(10000).default(10),
  maxUpliftPct: z.number().int().min(0).max(100).default(25),
  scarcityThresholdPct: z.number().int().min(0).max(100).default(20),
  scarcityUpliftPct: z.number().int().min(0).max(100).default(15),
});

async function ensureOwnership(promoterId: string, ttId: string): Promise<boolean> {
  const r = await db().query(
    `SELECT 1 FROM catalog.ticket_types tt
     JOIN catalog.events e ON e.id = tt.event_id
     WHERE tt.id = $1 AND e.promoter_id = $2`,
    [ttId, promoterId],
  );
  return r.rows.length > 0;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await ensureOwnership(promoter.promoterId, params.id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const ruleRes = await db().query<Record<string, unknown>>(
    `SELECT * FROM catalog.dynamic_pricing_rules WHERE ticket_type_id = $1`,
    [params.id],
  );
  const preview = await computeDynamicPrice(params.id);
  return NextResponse.json({
    rule: ruleRes.rows[0] ?? null,
    preview,
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.role === 'staff') {
    return NextResponse.json({ error: 'ADMIN_OR_OWNER_ONLY' }, { status: 403 });
  }
  if (!(await ensureOwnership(promoter.promoterId, params.id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const d = parsed.data;
  if (d.maxPriceMinor < d.minPriceMinor) {
    return NextResponse.json({ error: 'MAX_LESS_THAN_MIN' }, { status: 422 });
  }

  await db().query(
    `INSERT INTO catalog.dynamic_pricing_rules
       (ticket_type_id, enabled, min_price_minor, max_price_minor,
        velocity_threshold_per_hour, max_uplift_pct,
        scarcity_threshold_pct, scarcity_uplift_pct)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (ticket_type_id) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       min_price_minor = EXCLUDED.min_price_minor,
       max_price_minor = EXCLUDED.max_price_minor,
       velocity_threshold_per_hour = EXCLUDED.velocity_threshold_per_hour,
       max_uplift_pct = EXCLUDED.max_uplift_pct,
       scarcity_threshold_pct = EXCLUDED.scarcity_threshold_pct,
       scarcity_uplift_pct = EXCLUDED.scarcity_uplift_pct,
       updated_at = NOW()`,
    [
      params.id,
      d.enabled,
      d.minPriceMinor,
      d.maxPriceMinor,
      d.velocityThresholdPerHour,
      d.maxUpliftPct,
      d.scarcityThresholdPct,
      d.scarcityUpliftPct,
    ],
  );

  const result = await refreshDynamicPrice(params.id);
  return NextResponse.json({ ok: true, preview: result });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.role === 'staff') {
    return NextResponse.json({ error: 'ADMIN_OR_OWNER_ONLY' }, { status: 403 });
  }
  if (!(await ensureOwnership(promoter.promoterId, params.id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  await db().query(
    `DELETE FROM catalog.dynamic_pricing_rules WHERE ticket_type_id = $1`,
    [params.id],
  );
  await db().query(
    `UPDATE catalog.ticket_types SET dynamic_price_minor = NULL WHERE id = $1`,
    [params.id],
  );
  return NextResponse.json({ ok: true });
}
