/**
 * PATCH  /api/admin/ads/campaigns/[id]  — { status: 'active'|'paused', cpcHalire?, budgetTopUpHalire? }
 * DELETE /api/admin/ads/campaigns/[id]  — soft-delete (status='finished')
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';


const patchSchema = z.object({
  status: z.enum(['active', 'paused']).optional(),
  cpcHalire: z.number().int().min(100).max(100000).optional(),
  budgetTopUpHalire: z.number().int().min(1000).max(10_000_000).optional(),
});

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BAD_INPUT', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const updates: string[] = [];
  const args: unknown[] = [params.id, promoter.promoterId];
  if (parsed.data.status) {
    args.push(parsed.data.status);
    updates.push(`status = $${args.length}`);
  }
  if (parsed.data.cpcHalire !== undefined) {
    args.push(parsed.data.cpcHalire);
    updates.push(`cpc_halire = $${args.length}`);
  }
  if (parsed.data.budgetTopUpHalire !== undefined) {
    args.push(parsed.data.budgetTopUpHalire);
    updates.push(
      `budget_halire = budget_halire + $${args.length}, budget_remaining = budget_remaining + $${args.length}`,
    );
    // Pokud byla depleted a teď máme budget, reactivate
    updates.push(`status = CASE WHEN status = 'depleted' THEN 'active' ELSE status END`);
  }
  if (updates.length === 0) {
    return NextResponse.json({ error: 'NOTHING_TO_UPDATE' }, { status: 422 });
  }

  const r = await db().query<{ id: string }>(
    `UPDATE marketing.ad_campaigns
     SET ${updates.join(', ')}, updated_at = NOW()
     WHERE id = $1 AND promoter_id = $2
     RETURNING id`,
    args,
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });

  });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
  const r = await db().query<{ id: string }>(
    `UPDATE marketing.ad_campaigns
     SET status = 'finished', ends_at = COALESCE(ends_at, NOW()), updated_at = NOW()
     WHERE id = $1 AND promoter_id = $2
     RETURNING id`,
    [params.id, promoter.promoterId],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });

  });
}
