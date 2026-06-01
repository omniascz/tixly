/**
 * GET  /api/admin/subscription-plans — promotér's plans
 * POST /api/admin/subscription-plans — create plan
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter, runAsActivePromoterOwner } from '@/lib/admin-auth';
import { z } from 'zod';


interface PlanRow {
  id: string;
  name: string;
  description: string | null;
  price_halire: number;
  billing_cycle: string;
  allowance_per_period: number;
  active: boolean;
  active_subs: number;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const r = await db().query<PlanRow>(
    `SELECT p.id, p.name, p.description, p.price_halire, p.billing_cycle,
            p.allowance_per_period, p.active,
            (SELECT COUNT(*)::int FROM subscriptions.subscriptions s
             WHERE s.plan_id = p.id AND s.status = 'active') AS active_subs
     FROM subscriptions.plans p
     WHERE p.promoter_id = $1
     ORDER BY p.created_at DESC`,
    [promoter.promoterId],
  );
  return NextResponse.json({
    plans: r.rows.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      priceHalire: p.price_halire,
      billingCycle: p.billing_cycle,
      allowancePerPeriod: p.allowance_per_period,
      active: p.active,
      activeSubscriptions: p.active_subs,
    })),
  });

  });
}

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  priceHalire: z.number().int().min(0).max(100_000_000),
  billingCycle: z.enum(['monthly', 'yearly']),
  allowancePerPeriod: z.number().int().min(1).max(1000),
});

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoterOwner(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;
  const r = await db().query<{ id: string }>(
    `INSERT INTO subscriptions.plans
       (promoter_id, name, description, price_halire, billing_cycle, allowance_per_period)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      promoter.promoterId,
      input.name,
      input.description ?? null,
      input.priceHalire,
      input.billingCycle,
      input.allowancePerPeriod,
    ],
  );
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });

  });
}
