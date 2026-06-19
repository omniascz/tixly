import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter, runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

const CATEGORIES = ['napoje', 'jidlo', 'dezerty', 'ostatni'] as const;

interface MenuItemRow {
  id: string;
  event_id: string;
  name: string;
  description: string | null;
  price_halire: number;
  category: string;
  available_count: number | null;
  image_url: string | null;
  order_index: number;
  is_active: boolean;
  created_at: string;
}

async function ensureOwnership(eventId: string, promoterId: string): Promise<boolean> {
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
  return runAsPromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
    }
    if (!(await ensureOwnership(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const r = await db().query<MenuItemRow>(
      `SELECT id, event_id, name, description, price_halire, category,
              available_count, image_url, order_index, is_active, created_at
       FROM catalog.foyer_menu_items
       WHERE event_id = $1
       ORDER BY order_index, name`,
      [params.id],
    );

    return NextResponse.json({
      items: r.rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        priceHalire: row.price_halire,
        category: row.category,
        availableCount: row.available_count,
        imageUrl: row.image_url,
        orderIndex: row.order_index,
        isActive: row.is_active,
        createdAt: row.created_at,
      })),
    });
  });
}

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  priceHalire: z.number().int().min(0).max(100_000_00),
  category: z.enum(CATEGORIES),
  availableCount: z.number().int().min(0).nullable().optional(),
  imageUrl: z.string().url().max(500).nullable().optional(),
  orderIndex: z.number().int().default(0),
});

const patchSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  priceHalire: z.number().int().min(0).max(100_000_00).optional(),
  isActive: z.boolean().optional(),
  availableCount: z.number().int().min(0).nullable().optional(),
  orderIndex: z.number().int().optional(),
});

const deleteSchema = z.object({
  id: z.string().uuid(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
    }
    if (!(await ensureOwnership(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 422 },
      );
    }
    const d = parsed.data;

    const r = await db().query<{ id: string }>(
      `INSERT INTO catalog.foyer_menu_items
         (event_id, name, description, price_halire, category, available_count, image_url, order_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        params.id,
        d.name,
        d.description ?? null,
        d.priceHalire,
        d.category,
        d.availableCount ?? null,
        d.imageUrl ?? null,
        d.orderIndex,
      ],
    );

    return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
    }
    if (!(await ensureOwnership(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 422 },
      );
    }
    const d = parsed.data;

    const sets: string[] = [];
    const vals: unknown[] = [d.id, params.id];
    let idx = 3;

    if (d.name !== undefined) { sets.push(`name = $${idx++}`); vals.push(d.name); }
    if (d.description !== undefined) { sets.push(`description = $${idx++}`); vals.push(d.description); }
    if (d.priceHalire !== undefined) { sets.push(`price_halire = $${idx++}`); vals.push(d.priceHalire); }
    if (d.isActive !== undefined) { sets.push(`is_active = $${idx++}`); vals.push(d.isActive); }
    if (d.availableCount !== undefined) { sets.push(`available_count = $${idx++}`); vals.push(d.availableCount); }
    if (d.orderIndex !== undefined) { sets.push(`order_index = $${idx++}`); vals.push(d.orderIndex); }

    if (sets.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 422 });
    }

    const r = await db().query(
      `UPDATE catalog.foyer_menu_items
       SET ${sets.join(', ')}
       WHERE id = $1
         AND event_id = $2
         AND event_id IN (SELECT id FROM catalog.events WHERE promoter_id = $${idx})
       RETURNING id`,
      [...vals, promoter.promoterId],
    );

    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
    }
    if (!(await ensureOwnership(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 422 },
      );
    }

    await db().query(
      `DELETE FROM catalog.foyer_menu_items
       WHERE id = $1
         AND event_id = $2`,
      [parsed.data.id, params.id],
    );

    return NextResponse.json({ ok: true });
  });
}
