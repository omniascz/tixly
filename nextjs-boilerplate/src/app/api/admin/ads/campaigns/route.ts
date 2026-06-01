/**
 * GET  /api/admin/ads/campaigns       — list promotér's kampaní
 * POST /api/admin/ads/campaigns       — vytvoří kampaň
 *
 * Body POST: { eventId, slot, category?, cpcHalire, budgetHalire, startsAt?, endsAt? }
 *
 * Ownership: event musí patřit promotérovi. Min CPC = 100 hal (1 Kč), min budget = 10000 hal (100 Kč).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';


const createSchema = z.object({
  eventId: z.string().uuid(),
  slot: z.enum(['homepage_hero', 'homepage_featured', 'category_top', 'search_top']),
  category: z.string().max(80).optional(),
  cpcHalire: z.number().int().min(100).max(100000),
  budgetHalire: z.number().int().min(10000).max(10_000_000),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  crossPromoEnabled: z.boolean().optional(),
  bidStrategy: z.enum(['cpc', 'cpm', 'auto']).optional(),
  targetEventCategories: z.array(z.string().max(80)).max(20).optional(),
  targetPromoterIds: z.array(z.string().uuid()).max(50).optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
  const r = await db().query(
    `SELECT ac.id, ac.event_id, e.title AS event_title, ac.slot, ac.category,
            ac.status, ac.cpc_halire, ac.budget_halire, ac.budget_remaining,
            ac.impressions, ac.clicks, ac.starts_at, ac.ends_at, ac.created_at,
            ac.cross_promo_enabled, ac.bid_strategy
     FROM marketing.ad_campaigns ac
     JOIN catalog.events e ON e.id = ac.event_id
     WHERE ac.promoter_id = $1
     ORDER BY ac.created_at DESC`,
    [promoter.promoterId],
  );
  return NextResponse.json({ campaigns: r.rows });

  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BAD_INPUT', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  if (parsed.data.cpcHalire > parsed.data.budgetHalire) {
    return NextResponse.json(
      { error: 'BUDGET_TOO_LOW', message: 'Budget musí pokrýt alespoň jeden klik.' },
      { status: 422 },
    );
  }

  // Ownership: event patří promotérovi
  const own = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM catalog.events
     WHERE id = $1 AND promoter_id = $2`,
    [parsed.data.eventId, promoter.promoterId],
  );
  if (Number(own.rows[0]?.count ?? 0) === 0) {
    return NextResponse.json({ error: 'EVENT_NOT_OWNED' }, { status: 403 });
  }

  const r = await db().query<{ id: string }>(
    `INSERT INTO marketing.ad_campaigns
       (promoter_id, event_id, slot, category, cpc_halire, budget_halire, budget_remaining,
        starts_at, ends_at,
        cross_promo_enabled, bid_strategy, target_event_categories, target_promoter_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $6, COALESCE($7::timestamptz, NOW()), $8::timestamptz,
             COALESCE($9, false), COALESCE($10, 'cpc'), $11, $12)
     RETURNING id`,
    [
      promoter.promoterId,
      parsed.data.eventId,
      parsed.data.slot,
      parsed.data.category ?? null,
      parsed.data.cpcHalire,
      parsed.data.budgetHalire,
      parsed.data.startsAt ?? null,
      parsed.data.endsAt ?? null,
      parsed.data.crossPromoEnabled ?? null,
      parsed.data.bidStrategy ?? null,
      parsed.data.targetEventCategories ?? null,
      parsed.data.targetPromoterIds ?? null,
    ],
  );

  return NextResponse.json({ ok: true, id: r.rows[0]?.id });

  });
}
