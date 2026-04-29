/**
 * PATCH /api/admin/promo-codes/[id] — toggle active / change validity / max uses
 *
 * Body: { active?: boolean, maxUses?: number|null, validUntil?: string|null }
 *
 * Auth: requirePromoter, MUSÍ vlastnit kód (created_by_organizer_id).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Pool } from 'pg';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const schema = z
  .object({
    active: z.boolean().optional(),
    maxUses: z.number().int().min(1).max(100_000).nullable().optional(),
    validUntil: z.string().datetime().nullable().optional(),
  })
  .refine(
    (v) => v.active !== undefined || v.maxUses !== undefined || v.validUntil !== undefined,
    'alespoň jedno pole musí být přítomno',
  );

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;

  // Build SET clause dynamicky
  const sets: string[] = [];
  const args: unknown[] = [];
  let i = 1;
  if (input.active !== undefined) {
    sets.push(`active = $${i++}`);
    args.push(input.active);
  }
  if (input.maxUses !== undefined) {
    sets.push(`max_uses = $${i++}`);
    args.push(input.maxUses);
  }
  if (input.validUntil !== undefined) {
    sets.push(`valid_until = $${i++}`);
    args.push(input.validUntil);
  }
  sets.push(`updated_at = NOW()`);
  args.push(params.id, promoter.promoterId);

  const r = await db().query<{ id: string; active: boolean }>(
    `UPDATE marketing.promo_codes
     SET ${sets.join(', ')}
     WHERE id = $${i++} AND created_by_organizer_id = $${i}
     RETURNING id, active`,
    args,
  );
  if (r.rows.length === 0) {
    return NextResponse.json(
      { error: 'NOT_FOUND_OR_NOT_OWNER' },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, id: r.rows[0]!.id, active: r.rows[0]!.active });
}
