/**
 * GET  /api/admin/events/[id]/payment-plans — list plans for event
 * POST /api/admin/events/[id]/payment-plans — create plan
 *
 * Plan = "deposit X% + N instalments every D days".
 * Examples:
 *   - "Pay in full" = (deposit_pct=100, installments_count=0)
 *   - "25% deposit + 3 instalments monthly" = (25, 3, 30)
 *   - "Tomorrowland classic" = (33, 2, 60)  — 33% now, 33% +2mo, 34% +4mo
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter, runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';


interface PlanRow {
  id: string;
  name: string;
  deposit_pct: number;
  installments_count: number;
  interval_days: number;
  active: boolean;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const owns = await db().query(
    `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
    [params.id, promoter.promoterId],
  );
  if (owns.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const r = await db().query<PlanRow>(
    `SELECT id, name, deposit_pct, installments_count, interval_days, active
     FROM catalog.payment_plans
     WHERE event_id = $1
     ORDER BY deposit_pct DESC, installments_count ASC`,
    [params.id],
  );
  return NextResponse.json({ plans: r.rows });

  });
}

const createSchema = z.object({
  name: z.string().min(1).max(100),
  depositPct: z.number().int().min(0).max(100),
  installmentsCount: z.number().int().min(0).max(24),
  intervalDays: z.number().int().min(1).max(365).default(30),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;

  const owns = await db().query(
    `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
    [params.id, promoter.promoterId],
  );
  if (owns.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Pay-in-full ekvivalent musí mít depositPct=100 + installments=0.
  if (input.depositPct === 100 && input.installmentsCount > 0) {
    return NextResponse.json(
      { error: 'INVALID_PLAN', message: 'Plan with 100% deposit cannot have instalments.' },
      { status: 422 },
    );
  }
  if (input.depositPct < 100 && input.installmentsCount === 0) {
    return NextResponse.json(
      { error: 'INVALID_PLAN', message: 'Deposit < 100% requires at least 1 instalment.' },
      { status: 422 },
    );
  }

  const r = await db().query<{ id: string }>(
    `INSERT INTO catalog.payment_plans
       (event_id, promoter_id, name, deposit_pct, installments_count, interval_days)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      params.id,
      promoter.promoterId,
      input.name,
      input.depositPct,
      input.installmentsCount,
      input.intervalDays,
    ],
  );
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });

  });
}
