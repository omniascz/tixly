/**
 * GET  /api/admin/events/[id]/addons — list add-ons k akci
 * POST /api/admin/events/[id]/addons — create add-on
 *
 * Auth: requirePromoter, ownership check (event musí patřit promotérovi).
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

const ADDON_CATEGORIES = [
  'parking',
  'camping',
  'food',
  'drink',
  'merch',
  'transport',
  'accommodation',
  'insurance',
  'upgrade',
  'other',
] as const;

interface AddonRow {
  id: string;
  name: string;
  description: string | null;
  category: string;
  price_halire: number;
  max_quantity: number;
  stock_available: number | null;
  image_url: string | null;
  available: boolean;
  display_order: number;
  created_at: string;
}

async function ensureOwnership(
  eventId: string,
  promoterId: string,
): Promise<boolean> {
  const r = await db().query(
    `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2 LIMIT 1`,
    [eventId, promoterId],
  );
  return r.rows.length > 0;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
  }
  if (!(await ensureOwnership(params.id, promoter.promoterId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const r = await db().query<AddonRow>(
    `SELECT id, name, description, category, price_halire, max_quantity,
            stock_available, image_url, available, display_order, created_at
     FROM public.checkout_addons
     WHERE event_id = $1
     ORDER BY display_order, name`,
    [params.id],
  );
  return NextResponse.json({
    addons: r.rows.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      category: a.category,
      priceHalire: a.price_halire,
      maxQuantity: a.max_quantity,
      stockAvailable: a.stock_available,
      imageUrl: a.image_url,
      available: a.available,
      displayOrder: a.display_order,
    })),
  });
}

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  category: z.enum(ADDON_CATEGORIES),
  priceHalire: z.number().int().min(0).max(10_000_000),
  maxQuantity: z.number().int().min(1).max(100).default(1),
  stockAvailable: z.number().int().min(0).max(100_000).nullable().optional(),
  imageUrl: z.string().url().max(500).nullable().optional(),
  displayOrder: z.number().int().default(0),
});

export async function POST(
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
  if (!(await ensureOwnership(params.id, promoter.promoterId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;

  const r = await db().query<{ id: string }>(
    `INSERT INTO public.checkout_addons
       (promoter_id, event_id, name, description, category, price_halire,
        max_quantity, stock_available, image_url, display_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      promoter.promoterId,
      params.id,
      input.name,
      input.description ?? null,
      input.category,
      input.priceHalire,
      input.maxQuantity,
      input.stockAvailable ?? null,
      input.imageUrl ?? null,
      input.displayOrder,
    ],
  );
  return NextResponse.json({ id: r.rows[0]!.id }, { status: 201 });
}
