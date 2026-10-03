/**
 * GET  /api/buyer/subscriptions       — moje aktivní + minulé subscriptions
 * POST /api/buyer/subscriptions       — subscribe k plánu (POZN: bez platební brány vyrobí status='active' rovnou; produkčně by tu byl payment flow)
 *
 * Query GET: ?promoterSlug=divadlo-verze → vrátí i dostupné plány tohoto promotéra
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { z } from 'zod';
import { demoPathDisabledResponse } from '@/lib/payment/demo-path-guard';


interface SubRow {
  id: string;
  plan_id: string;
  plan_name: string;
  promoter_id: string;
  promoter_name: string;
  promoter_slug: string;
  price_halire: number;
  billing_cycle: string;
  allowance_per_period: number;
  status: string;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  consumptions_count: number;
}

interface PlanRow {
  id: string;
  name: string;
  description: string | null;
  price_halire: number;
  billing_cycle: string;
  allowance_per_period: number;
  promoter_id: string;
  promoter_name: string;
  promoter_slug: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const promoterSlug = req.nextUrl.searchParams.get('promoterSlug');

  const subsRes = await db().query<SubRow>(
    `SELECT s.id, s.plan_id, p.name AS plan_name,
            pr.id AS promoter_id, pr.name AS promoter_name, pr.slug AS promoter_slug,
            p.price_halire, p.billing_cycle, p.allowance_per_period,
            s.status, s.current_period_start, s.current_period_end, s.cancel_at_period_end,
            (SELECT COUNT(*)::int FROM subscriptions.consumptions c
             WHERE c.subscription_id = s.id
               AND c.period_start = s.current_period_start) AS consumptions_count
     FROM subscriptions.subscriptions s
     JOIN subscriptions.plans p ON p.id = s.plan_id
     JOIN platform.promoters pr ON pr.id = p.promoter_id
     WHERE s.user_id = $1
     ORDER BY s.created_at DESC`,
    [userId],
  );

  let availablePlans: PlanRow[] = [];
  if (promoterSlug) {
    const r = await db().query<PlanRow>(
      `SELECT p.id, p.name, p.description, p.price_halire, p.billing_cycle, p.allowance_per_period,
              pr.id AS promoter_id, pr.name AS promoter_name, pr.slug AS promoter_slug
       FROM subscriptions.plans p
       JOIN platform.promoters pr ON pr.id = p.promoter_id
       WHERE p.active = true AND pr.slug = $1
       ORDER BY p.price_halire`,
      [promoterSlug],
    );
    availablePlans = r.rows;
  }

  return NextResponse.json({
    mySubscriptions: subsRes.rows.map((s) => ({
      id: s.id,
      planId: s.plan_id,
      planName: s.plan_name,
      promoterId: s.promoter_id,
      promoterName: s.promoter_name,
      promoterSlug: s.promoter_slug,
      priceHalire: s.price_halire,
      billingCycle: s.billing_cycle,
      allowancePerPeriod: s.allowance_per_period,
      status: s.status,
      currentPeriodStart: s.current_period_start,
      currentPeriodEnd: s.current_period_end,
      cancelAtPeriodEnd: s.cancel_at_period_end,
      consumptionsUsed: s.consumptions_count,
      consumptionsRemaining: s.allowance_per_period - s.consumptions_count,
    })),
    availablePlans: availablePlans.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      priceHalire: p.price_halire,
      billingCycle: p.billing_cycle,
      allowancePerPeriod: p.allowance_per_period,
      promoter: { id: p.promoter_id, name: p.promoter_name, slug: p.promoter_slug },
    })),
  });

  });
}

const createSchema = z.object({
  planId: z.string().uuid(),
});

export async function POST(req: NextRequest): Promise<Response> {
  // Kolo 6: hodnota bez platby (třída K1) — vypnuto, dokud není napojený skutečný platební tok
  // (create payment → webhook → paid → aktivace). Viz lib/payment/demo-path-guard.ts.
  const demoOff = demoPathDisabledResponse();
  if (demoOff) return demoOff;
  return runAsUser(req, async (userId) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_INPUT' }, { status: 422 });
  }

  // Plan existuje a je active
  const planRes = await db().query<{
    id: string;
    promoter_id: string;
    billing_cycle: string;
  }>(
    `SELECT id, promoter_id, billing_cycle
     FROM subscriptions.plans
     WHERE id = $1 AND active = true`,
    [parsed.data.planId],
  );
  if (planRes.rows.length === 0) {
    return NextResponse.json({ error: 'PLAN_NOT_FOUND' }, { status: 404 });
  }
  const plan = planRes.rows[0];

  // Duplicate guard — pokud má active subscription stejného plánu, vrátí ji
  const exists = await db().query<{ id: string }>(
    `SELECT id FROM subscriptions.subscriptions
     WHERE user_id = $1 AND plan_id = $2 AND status = 'active'`,
    [userId, plan.id],
  );
  if (exists.rows.length > 0) {
    return NextResponse.json(
      { error: 'ALREADY_SUBSCRIBED', subscriptionId: exists.rows[0].id },
      { status: 409 },
    );
  }

  // Period end
  const now = new Date();
  const periodEnd = new Date(now);
  if (plan.billing_cycle === 'yearly') {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  } else {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  }

  // POZN: produkčně by tu byl payment flow přes platební bránu.
  // Bez ní vyrobíme status='active' rovnou.
  const r = await db().query<{ id: string }>(
    `INSERT INTO subscriptions.subscriptions
       (user_id, plan_id, status, current_period_start, current_period_end, next_billing_at)
     VALUES ($1, $2, 'active', now(), $3, $3)
     RETURNING id`,
    [userId, plan.id, periodEnd.toISOString()],
  );

  // Audit log
  await db().query(
    `INSERT INTO audit.audit_log
       (schema_name, table_name, record_id, action, actor_id, actor_type, new_values)
     VALUES ('subscriptions', 'subscriptions', $1, 'INSERT', $2, 'user', $3::jsonb)`,
    [
      r.rows[0].id,
      userId,
      JSON.stringify({ planId: plan.id, status: 'active', kind: 'subscribe' }),
    ],
  );

  return NextResponse.json(
    {
      subscriptionId: r.rows[0].id,
      currentPeriodEnd: periodEnd.toISOString(),
      note: 'Bez platební brány — předplatné aktivní okamžitě (demo).',
    },
    { status: 201 },
  );

  });
}
