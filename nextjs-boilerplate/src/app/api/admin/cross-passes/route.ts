/**
 * GET  /api/admin/cross-passes — list bundlů promotéra
 * POST /api/admin/cross-passes — create bundle (multi-event pass)
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

interface BundleRow {
  id: string;
  name: string;
  description: string | null;
  price_halire: number;
  capacity: number | null;
  remaining_qty: number | null;
  active: boolean;
  event_count: number;
  members_count: number;
}

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const r = await db().query<BundleRow>(
    `SELECT b.id, b.name, b.description, b.price_halire, b.capacity,
            b.remaining_qty, b.active,
            (SELECT COUNT(*)::int FROM catalog.cross_pass_events WHERE bundle_id = b.id) AS event_count,
            (SELECT COUNT(*)::int FROM tickets.cross_pass_memberships
             WHERE bundle_id = b.id AND status = 'active') AS members_count
     FROM catalog.cross_pass_bundles b
     WHERE b.promoter_id = $1
     ORDER BY b.created_at DESC`,
    [promoter.promoterId],
  );
  return NextResponse.json({ bundles: r.rows });
}

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  priceHalire: z.number().int().min(0).max(100_000_000),
  capacity: z.number().int().min(1).max(1_000_000).nullable().optional(),
  eventIds: z.array(z.string().uuid()).min(2).max(50),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active' || promoter.role !== 'owner') {
    return NextResponse.json({ error: 'OWNER_ONLY' }, { status: 403 });
  }
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    // Validate ownership všech events
    const ownership = await client.query<{ id: string }>(
      `SELECT id FROM catalog.events
       WHERE id = ANY($1::uuid[]) AND promoter_id = $2`,
      [input.eventIds, promoter.promoterId],
    );
    if (ownership.rows.length !== input.eventIds.length) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'EVENT_NOT_OWNED', message: 'Některý event nepatří promotérovi.' },
        { status: 422 },
      );
    }
    const r = await client.query<{ id: string }>(
      `INSERT INTO catalog.cross_pass_bundles
         (promoter_id, name, description, price_halire, capacity,
          remaining_qty, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $5, $6, $7)
       RETURNING id`,
      [
        promoter.promoterId,
        input.name,
        input.description ?? null,
        input.priceHalire,
        input.capacity ?? null,
        input.startsAt ?? null,
        input.endsAt ?? null,
      ],
    );
    const bundleId = r.rows[0].id;
    for (let i = 0; i < input.eventIds.length; i++) {
      await client.query(
        `INSERT INTO catalog.cross_pass_events (bundle_id, event_id, display_order)
         VALUES ($1, $2, $3)`,
        [bundleId, input.eventIds[i], i],
      );
    }
    await client.query('COMMIT');
    return NextResponse.json({ id: bundleId }, { status: 201 });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[cross-pass create]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
