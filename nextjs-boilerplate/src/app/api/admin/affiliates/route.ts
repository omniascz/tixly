/**
 * GET  /api/admin/affiliates — list všech promoterových affiliates s stats
 * POST /api/admin/affiliates — create new affiliate
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

const createSchema = z.object({
  code: z.string().min(2).max(40).regex(/^[A-Z0-9_-]+$/),
  name: z.string().min(2).max(120),
  email: z.string().email().max(200).nullable().optional(),
  commissionPct: z.number().int().min(0).max(50),
  bankAccount: z.string().max(60).nullable().optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const r = await db().query<{
    id: string;
    code: string;
    name: string;
    email: string | null;
    commission_pct: number;
    active: boolean;
    orders_count: number;
    revenue_total: string;
    commission_total: string;
  }>(
    `SELECT a.id, a.code, a.name, a.email, a.commission_pct, a.active,
            (SELECT COUNT(*)::int FROM orders.orders WHERE affiliate_id = a.id AND status IN ('paid','paid_partial')) AS orders_count,
            (SELECT COALESCE(SUM(total_amount), 0)::text FROM orders.orders WHERE affiliate_id = a.id AND status IN ('paid','paid_partial')) AS revenue_total,
            (SELECT COALESCE(SUM(affiliate_commission_minor), 0)::text FROM orders.orders WHERE affiliate_id = a.id AND status IN ('paid','paid_partial')) AS commission_total
     FROM marketing.affiliates a
     WHERE a.promoter_id = $1
     ORDER BY a.created_at DESC`,
    [promoter.promoterId],
  );
  return NextResponse.json({ affiliates: r.rows });
}

export async function POST(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active' || promoter.role === 'staff') {
    return NextResponse.json({ error: 'ADMIN_OR_OWNER_ONLY' }, { status: 403 });
  }
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  try {
    const r = await db().query<{ id: string }>(
      `INSERT INTO marketing.affiliates
         (promoter_id, code, name, email, commission_pct, bank_account)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        promoter.promoterId,
        parsed.data.code.toUpperCase(),
        parsed.data.name,
        parsed.data.email ?? null,
        parsed.data.commissionPct,
        parsed.data.bankAccount ?? null,
      ],
    );
    return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'CODE_TAKEN' }, { status: 409 });
    }
    throw err;
  }
}
