/**
 * POST /api/admin/payouts/settle
 *
 * Markuje chargebacks holdback_applied=TRUE pro daný settlement window.
 * Volá se po reálném bank transferu net payoutu na účet promotéra
 * (Super Admin operation).
 *
 * Body: { periodStart, periodEnd } — ISO timestampy
 *
 * Vrátí seznam chargebacks zahrnutých do holdbacku.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';


const schema = z.object({
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
});

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BAD_INPUT', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const r = await db().query<{ id: string; amount_halire: number; status: string }>(
    `UPDATE orders.chargebacks
     SET holdback_applied = TRUE, updated_at = NOW()
     WHERE promoter_id = $1
       AND holdback_applied = FALSE
       AND status IN ('needs_response', 'under_review', 'lost')
       AND created_at >= $2::timestamptz
       AND created_at <  $3::timestamptz
     RETURNING id, amount_halire, status`,
    [promoter.promoterId, parsed.data.periodStart, parsed.data.periodEnd],
  );

  const totalHalire = r.rows.reduce((sum, row) => sum + row.amount_halire, 0);

  return NextResponse.json({
    ok: true,
    settled: r.rows.length,
    totalHalire,
    chargebackIds: r.rows.map((row) => row.id),
  });

  });
}
