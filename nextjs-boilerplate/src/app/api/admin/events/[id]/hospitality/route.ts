/**
 * GET  /api/admin/events/[id]/hospitality — list packages + recent inquiries
 * POST /api/admin/events/[id]/hospitality — create package
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
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  capacity: z.number().int().min(1).max(10_000),
  priceMinor: z.number().int().min(0),
  currency: z.enum(['CZK', 'EUR', 'USD', 'GBP', 'PLN']).default('CZK'),
  includes: z.array(z.string().max(200)).max(20).optional(),
  visibility: z.enum(['public', 'invite_only']).default('invite_only'),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const owns = await db().query(
    `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
    [params.id, promoter.promoterId],
  );
  if (owns.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [pkgs, inquiries] = await Promise.all([
    db().query<{
      id: string;
      name: string;
      description: string | null;
      capacity: number;
      remaining_qty: number;
      price_minor: number;
      currency: string;
      includes: unknown;
      visibility: string;
      active: boolean;
    }>(
      `SELECT id, name, description, capacity, remaining_qty, price_minor, currency,
              includes, visibility, active
       FROM catalog.hospitality_packages
       WHERE event_id = $1
       ORDER BY created_at DESC`,
      [params.id],
    ),
    db().query<{
      id: string;
      package_id: string;
      package_name: string;
      company_name: string;
      contact_email: string;
      quantity: number;
      status: string;
      total_amount_minor: number | null;
      currency: string;
      created_at: string;
    }>(
      `SELECT i.id, i.package_id, p.name AS package_name, i.company_name, i.contact_email,
              i.quantity, i.status, i.total_amount_minor, i.currency, i.created_at
       FROM orders.hospitality_inquiries i
       JOIN catalog.hospitality_packages p ON p.id = i.package_id
       WHERE p.event_id = $1
       ORDER BY i.created_at DESC
       LIMIT 100`,
      [params.id],
    ),
  ]);

  return NextResponse.json({
    packages: pkgs.rows,
    inquiries: inquiries.rows,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active' || promoter.role === 'staff') {
    return NextResponse.json({ error: 'ADMIN_OR_OWNER_ONLY' }, { status: 403 });
  }

  const owns = await db().query(
    `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
    [params.id, promoter.promoterId],
  );
  if (owns.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const r = await db().query<{ id: string }>(
    `INSERT INTO catalog.hospitality_packages
       (event_id, name, description, capacity, remaining_qty, price_minor, currency,
        includes, visibility)
     VALUES ($1, $2, $3, $4, $4, $5, $6, $7::jsonb, $8)
     RETURNING id`,
    [
      params.id,
      parsed.data.name,
      parsed.data.description ?? null,
      parsed.data.capacity,
      parsed.data.priceMinor,
      parsed.data.currency,
      JSON.stringify(parsed.data.includes ?? []),
      parsed.data.visibility,
    ],
  );
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
}
