/**
 * GET  /api/admin/member-pricing-rules?ticketTypeId=X — list rules pro ticket type
 * POST /api/admin/member-pricing-rules — create rule (group + ticket type → discount)
 * DELETE /api/admin/member-pricing-rules?id=X — remove rule
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

const postSchema = z
  .object({
    ticketTypeId: z.string().uuid(),
    groupId: z.string().uuid(),
    discountPct: z.number().int().min(0).max(100).optional(),
    fixedPriceMinor: z.number().int().min(0).optional(),
  })
  .refine((d) => d.discountPct !== undefined || d.fixedPriceMinor !== undefined, {
    message: 'Musíš zadat discountPct nebo fixedPriceMinor.',
  });

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ticketTypeId = req.nextUrl.searchParams.get('ticketTypeId');
  const args: unknown[] = [promoter.promoterId];
  let where = `mg.promoter_id = $1`;
  if (ticketTypeId) {
    args.push(ticketTypeId);
    where += ` AND mpr.ticket_type_id = $${args.length}`;
  }

  const r = await db().query<{
    id: string;
    ticket_type_id: string;
    ticket_type_name: string;
    group_id: string;
    group_name: string;
    discount_pct: number | null;
    fixed_price_minor: number | null;
    active: boolean;
  }>(
    `SELECT mpr.id, mpr.ticket_type_id, tt.name AS ticket_type_name,
            mpr.group_id, mg.name AS group_name,
            mpr.discount_pct, mpr.fixed_price_minor, mpr.active
     FROM catalog.member_pricing_rules mpr
     JOIN platform.member_groups mg ON mg.id = mpr.group_id
     JOIN catalog.ticket_types tt ON tt.id = mpr.ticket_type_id
     WHERE ${where}
     ORDER BY tt.name, mg.name`,
    args,
  );
  return NextResponse.json({ rules: r.rows });
}

export async function POST(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active' || promoter.role === 'staff') {
    return NextResponse.json({ error: 'ADMIN_OR_OWNER_ONLY' }, { status: 403 });
  }
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  // Ownership cross-check
  const owns = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM catalog.ticket_types tt
     JOIN catalog.events e ON e.id = tt.event_id
     JOIN platform.member_groups mg ON mg.id = $2
     WHERE tt.id = $1 AND e.promoter_id = $3 AND mg.promoter_id = $3`,
    [parsed.data.ticketTypeId, parsed.data.groupId, promoter.promoterId],
  );
  if (Number(owns.rows[0]?.count ?? 0) === 0) {
    return NextResponse.json({ error: 'NOT_OWNED' }, { status: 403 });
  }

  try {
    const r = await db().query<{ id: string }>(
      `INSERT INTO catalog.member_pricing_rules
         (ticket_type_id, group_id, discount_pct, fixed_price_minor)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (ticket_type_id, group_id) DO UPDATE
         SET discount_pct = EXCLUDED.discount_pct,
             fixed_price_minor = EXCLUDED.fixed_price_minor,
             active = true
       RETURNING id`,
      [
        parsed.data.ticketTypeId,
        parsed.data.groupId,
        parsed.data.discountPct ?? null,
        parsed.data.fixedPriceMinor ?? null,
      ],
    );
    return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
  } catch (err) {
    console.error('[member pricing rule]', err);
    throw err;
  }
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.role === 'staff') {
    return NextResponse.json({ error: 'ADMIN_OR_OWNER_ONLY' }, { status: 403 });
  }
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 422 });
  await db().query(
    `DELETE FROM catalog.member_pricing_rules
     WHERE id = $1 AND group_id IN (
       SELECT id FROM platform.member_groups WHERE promoter_id = $2
     )`,
    [id, promoter.promoterId],
  );
  return NextResponse.json({ ok: true });
}
