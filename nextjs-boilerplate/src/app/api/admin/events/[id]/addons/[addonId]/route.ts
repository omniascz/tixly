/**
 * PATCH  /api/admin/events/[id]/addons/[addonId]
 * DELETE /api/admin/events/[id]/addons/[addonId]
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

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  priceHalire: z.number().int().min(0).max(10_000_000).optional(),
  maxQuantity: z.number().int().min(1).max(100).optional(),
  stockAvailable: z.number().int().min(0).max(100_000).nullable().optional(),
  available: z.boolean().optional(),
  displayOrder: z.number().int().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; addonId: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(params.addonId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 422 });
  }
  const input = parsed.data;

  const sets: string[] = [];
  const args: unknown[] = [];
  let i = 1;
  const colMap: Record<string, string> = {
    name: 'name',
    description: 'description',
    priceHalire: 'price_halire',
    maxQuantity: 'max_quantity',
    stockAvailable: 'stock_available',
    available: 'available',
    displayOrder: 'display_order',
  };
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    sets.push(`${colMap[k]} = $${i++}`);
    args.push(v);
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 422 });
  }
  args.push(params.addonId, params.id, promoter.promoterId);

  const r = await db().query<{ id: string }>(
    `UPDATE public.checkout_addons
     SET ${sets.join(', ')}
     WHERE id = $${i++} AND event_id = $${i++} AND promoter_id = $${i}
     RETURNING id`,
    args,
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; addonId: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(params.addonId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
  }

  // Block delete pokud má objednávky
  const usage = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM public.order_addons
     WHERE addon_id = $1 AND status = 'confirmed'`,
    [params.addonId],
  );
  if (Number(usage.rows[0]?.count ?? 0) > 0) {
    return NextResponse.json(
      {
        error: 'ADDON_IN_USE',
        message: 'Add-on už byl prodán. Můžeš ho jen deaktivovat (available=false).',
      },
      { status: 409 },
    );
  }

  const r = await db().query<{ id: string }>(
    `DELETE FROM public.checkout_addons
     WHERE id = $1 AND event_id = $2 AND promoter_id = $3
     RETURNING id`,
    [params.addonId, params.id, promoter.promoterId],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
