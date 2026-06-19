import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

interface ProductRow {
  id: string;
  promoter_id: string;
  title: string;
  description: string | null;
  price_halire: number;
  total_uses: number;
  valid_from: string | null;
  valid_until: string;
  max_per_buyer: number | null;
  is_active: boolean;
  created_at: string;
  sold_count: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const r = await db().query<ProductRow>(
      `SELECT p.*,
              (SELECT COUNT(*)::text FROM orders.season_passes sp WHERE sp.product_id = p.id) AS sold_count
       FROM catalog.season_pass_products p
       WHERE p.promoter_id = $1
       ORDER BY p.created_at DESC`,
      [promoter.promoterId],
    );
    return NextResponse.json({
      products: r.rows.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        priceHalire: p.price_halire,
        totalUses: p.total_uses,
        validFrom: p.valid_from,
        validUntil: p.valid_until,
        maxPerBuyer: p.max_per_buyer,
        isActive: p.is_active,
        soldCount: Number(p.sold_count),
        createdAt: p.created_at,
      })),
    });
  });
}

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  priceHalire: z.number().int().min(0),
  totalUses: z.number().int().min(1).max(1000),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime(),
  maxPerBuyer: z.number().int().min(1).optional(),
  isActive: z.boolean().optional(),
});

const patchSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  priceHalire: z.number().int().min(0).optional(),
  totalUses: z.number().int().min(1).max(1000).optional(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
  maxPerBuyer: z.number().int().min(1).optional(),
  isActive: z.boolean().optional(),
});

const deleteSchema = z.object({ id: z.string().uuid() });

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    }
    const d = parsed.data;
    const r = await db().query<ProductRow>(
      `INSERT INTO catalog.season_pass_products
         (promoter_id, title, description, price_halire, total_uses,
          valid_from, valid_until, max_per_buyer, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        promoter.promoterId,
        d.title,
        d.description ?? null,
        d.priceHalire,
        d.totalUses,
        d.validFrom ?? null,
        d.validUntil,
        d.maxPerBuyer ?? null,
        d.isActive ?? true,
      ],
    );
    return NextResponse.json({ product: r.rows[0] }, { status: 201 });
  });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    }
    const { id, ...fields } = parsed.data;

    const owns = await db().query<{ id: string }>(
      `SELECT id FROM catalog.season_pass_products WHERE id = $1 AND promoter_id = $2`,
      [id, promoter.promoterId],
    );
    if (owns.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const sets: string[] = [];
    const vals: unknown[] = [id];
    if (fields.title !== undefined) { vals.push(fields.title); sets.push(`title = $${vals.length}`); }
    if (fields.description !== undefined) { vals.push(fields.description); sets.push(`description = $${vals.length}`); }
    if (fields.priceHalire !== undefined) { vals.push(fields.priceHalire); sets.push(`price_halire = $${vals.length}`); }
    if (fields.totalUses !== undefined) { vals.push(fields.totalUses); sets.push(`total_uses = $${vals.length}`); }
    if (fields.validFrom !== undefined) { vals.push(fields.validFrom); sets.push(`valid_from = $${vals.length}`); }
    if (fields.validUntil !== undefined) { vals.push(fields.validUntil); sets.push(`valid_until = $${vals.length}`); }
    if (fields.maxPerBuyer !== undefined) { vals.push(fields.maxPerBuyer); sets.push(`max_per_buyer = $${vals.length}`); }
    if (fields.isActive !== undefined) { vals.push(fields.isActive); sets.push(`is_active = $${vals.length}`); }

    if (sets.length === 0) {
      return NextResponse.json({ error: 'NO_FIELDS' }, { status: 422 });
    }
    sets.push(`updated_at = NOW()`);

    await db().query(
      `UPDATE catalog.season_pass_products SET ${sets.join(', ')} WHERE id = $1`,
      vals,
    );
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
    }
    const { id } = parsed.data;

    const owns = await db().query<{ id: string }>(
      `SELECT id FROM catalog.season_pass_products WHERE id = $1 AND promoter_id = $2`,
      [id, promoter.promoterId],
    );
    if (owns.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const sold = await db().query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM orders.season_passes WHERE product_id = $1`,
      [id],
    );
    if (Number(sold.rows[0].cnt) > 0) {
      return NextResponse.json({ error: 'HAS_SOLD_PASSES', count: Number(sold.rows[0].cnt) }, { status: 409 });
    }

    await db().query(`DELETE FROM catalog.season_pass_products WHERE id = $1`, [id]);
    return NextResponse.json({ ok: true });
  });
}
