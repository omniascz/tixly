/**
 * GET  /api/admin/events/[id]/bundles
 * POST /api/admin/events/[id]/bundles
 *
 * Bundle = ticket type + N add-ons s % slevou.
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

interface BundleRow {
  id: string;
  name: string;
  description: string | null;
  ticket_type_id: string;
  ticket_type_name: string;
  ticket_price: number;
  discount_pct: number;
  active: boolean;
  display_order: number;
  addon_count: number;
  bundle_addons_total_halire: number;
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
  if (!(await ensureOwnership(params.id, promoter.promoterId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const r = await db().query<BundleRow>(
    `SELECT b.id, b.name, b.description, b.ticket_type_id,
            tt.name AS ticket_type_name, tt.base_price AS ticket_price,
            b.discount_pct, b.active, b.display_order,
            (SELECT COUNT(*)::int FROM catalog.event_bundle_addons WHERE bundle_id = b.id) AS addon_count,
            COALESCE((
              SELECT SUM(ca.price_halire * ba.quantity)::int
              FROM catalog.event_bundle_addons ba
              JOIN public.checkout_addons ca ON ca.id = ba.addon_id
              WHERE ba.bundle_id = b.id
            ), 0) AS bundle_addons_total_halire
     FROM catalog.event_bundles b
     JOIN catalog.ticket_types tt ON tt.id = b.ticket_type_id
     WHERE b.event_id = $1
     ORDER BY b.display_order, b.created_at`,
    [params.id],
  );
  return NextResponse.json({
    bundles: r.rows.map((b) => {
      const grossHalire = b.ticket_price + b.bundle_addons_total_halire;
      const discountedHalire = Math.floor(grossHalire * (1 - b.discount_pct / 100));
      return {
        id: b.id,
        name: b.name,
        description: b.description,
        ticketTypeId: b.ticket_type_id,
        ticketTypeName: b.ticket_type_name,
        discountPct: b.discount_pct,
        active: b.active,
        addonCount: b.addon_count,
        grossPriceHalire: grossHalire,
        finalPriceHalire: discountedHalire,
      };
    }),
  });
}

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  ticketTypeId: z.string().uuid(),
  addons: z
    .array(
      z.object({
        addonId: z.string().uuid(),
        quantity: z.number().int().min(1).max(20),
      }),
    )
    .min(1)
    .max(10),
  discountPct: z.number().int().min(0).max(100).default(0),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

  // Validuj, že ticket_type patří k akci
  const ttCheck = await db().query(
    `SELECT 1 FROM catalog.ticket_types WHERE id = $1 AND event_id = $2`,
    [input.ticketTypeId, params.id],
  );
  if (ttCheck.rows.length === 0) {
    return NextResponse.json(
      { error: 'TICKET_TYPE_NOT_IN_EVENT' },
      { status: 422 },
    );
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const r = await client.query<{ id: string }>(
      `INSERT INTO catalog.event_bundles
         (event_id, name, description, ticket_type_id, discount_pct)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        params.id,
        input.name,
        input.description ?? null,
        input.ticketTypeId,
        input.discountPct,
      ],
    );
    const bundleId = r.rows[0]!.id;

    for (const a of input.addons) {
      await client.query(
        `INSERT INTO catalog.event_bundle_addons (bundle_id, addon_id, quantity)
         VALUES ($1, $2, $3)`,
        [bundleId, a.addonId, a.quantity],
      );
    }
    await client.query('COMMIT');
    return NextResponse.json({ id: bundleId }, { status: 201 });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST bundle]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
