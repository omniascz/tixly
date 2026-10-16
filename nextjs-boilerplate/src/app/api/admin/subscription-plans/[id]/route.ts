/**
 * PATCH  /api/admin/subscription-plans/[id] — toggle active, change price/allowance
 * DELETE /api/admin/subscription-plans/[id] — soft delete (active=false) pokud má subscribers; jinak hard delete
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoterOwner } from '@/lib/admin-auth';
import { z } from 'zod';


const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  priceHalire: z.number().int().min(0).max(100_000_000).optional(),
  allowancePerPeriod: z.number().int().min(1).max(1000).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsPromoterOwner(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_INPUT' }, { status: 422 });
  }

  // Ownership check
  const own = await db().query<{ id: string }>(
    `SELECT id FROM subscriptions.plans WHERE id = $1 AND promoter_id = $2`,
    [params.id, promoter.promoterId],
  );
  if (own.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const updates: string[] = [];
  const args: unknown[] = [params.id];
  let p = 2;
  for (const [key, sqlCol] of [
    ['name', 'name'],
    ['description', 'description'],
    ['priceHalire', 'price_halire'],
    ['allowancePerPeriod', 'allowance_per_period'],
    ['active', 'active'],
  ] as const) {
    const v = (parsed.data as Record<string, unknown>)[key];
    if (v !== undefined) {
      args.push(v as never);
      updates.push(`${sqlCol} = $${p++}`);
    }
  }
  if (updates.length === 0) return NextResponse.json({ ok: true, unchanged: true });

  await db().query(
    `UPDATE subscriptions.plans SET ${updates.join(', ')} WHERE id = $1`,
    args,
  );
  return NextResponse.json({ ok: true });

  });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsPromoterOwner(req, async (promoter) => {
  // Pokud existují aktivní subscriptions → soft delete (active=false)
  const subs = await db().query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM subscriptions.subscriptions
     WHERE plan_id = $1 AND status = 'active'`,
    [params.id],
  );
  const hasActive = Number(subs.rows[0]?.cnt ?? 0) > 0;

  if (hasActive) {
    await db().query(
      `UPDATE subscriptions.plans SET active = false
       WHERE id = $1 AND promoter_id = $2`,
      [params.id, promoter.promoterId],
    );
    return NextResponse.json({ ok: true, softDeleted: true });
  } else {
    const r = await db().query(
      `DELETE FROM subscriptions.plans WHERE id = $1 AND promoter_id = $2`,
      [params.id, promoter.promoterId],
    );
    if (r.rowCount === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, deleted: true });
  }

  });
}
