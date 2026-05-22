/**
 * PATCH /api/admin/subscriptions/packages/[id] — update package
 *   Body: { status?: 'draft'|'on_sale'|'sold_out'|'closed'|'archived',
 *           name?, description?, basePriceHalire?, capacity?, eventIds? }
 *
 * GET /api/admin/subscriptions/packages/[id] — single package detail
 *   včetně linked events + holders summary.
 *
 * Auth: requirePromoter (owner-only).
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
  status: z
    .enum(['draft', 'on_sale', 'sold_out', 'closed', 'archived'])
    .optional(),
  name: z.string().min(2).max(200).optional(),
  description: z.string().max(2000).optional(),
  basePriceHalire: z.number().int().positive().optional(),
  capacity: z.number().int().positive().nullable().optional(),
  eventIds: z.array(z.string().uuid()).optional(),
});

async function assertOwnership(
  packageId: string,
  promoterId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  // RLS bypass — ownership check sám validuje promoter scope.
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.is_platform_admin = 'true'`);
    const r = await client.query<{ promoter_id: string }>(
      `SELECT promoter_id FROM subscriptions.packages WHERE id = $1`,
      [packageId],
    );
    await client.query('COMMIT');
    if (r.rows.length === 0) return { ok: false, status: 404, error: 'NOT_FOUND' };
    if (r.rows[0].promoter_id !== promoterId)
      return { ok: false, status: 403, error: 'FORBIDDEN' };
    return { ok: true };
  } finally {
    client.release();
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const own = await assertOwnership(params.id, promoter.promoterId);
  if (!own.ok) return NextResponse.json({ error: own.error }, { status: own.status });

  const pkg = await db().query(
    `SELECT id, name, slug, season_label, category, base_price_halire,
            currency, status, sale_start::text, sale_end::text, capacity,
            abo_type, max_picks_for_choice, description, created_at::text
       FROM subscriptions.packages WHERE id = $1`,
    [params.id],
  );
  const events = await db().query(
    `SELECT pe.event_id, pe.order_index, e.title, e.date_start::text
       FROM subscriptions.package_events pe
       JOIN catalog.events e ON e.id = pe.event_id
      WHERE pe.package_id = $1
      ORDER BY pe.order_index ASC`,
    [params.id],
  );

  return NextResponse.json({
    package: pkg.rows[0],
    events: events.rows,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.role === 'staff') {
    return NextResponse.json({ error: 'ADMIN_OR_OWNER_ONLY' }, { status: 403 });
  }

  const own = await assertOwnership(params.id, promoter.promoterId);
  if (!own.ok) return NextResponse.json({ error: own.error }, { status: own.status });

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_BODY', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const d = parsed.data;

  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if (d.status !== undefined) {
    sets.push(`status = $${idx++}`);
    values.push(d.status);
  }
  if (d.name !== undefined) {
    sets.push(`name = $${idx++}`);
    values.push(d.name);
  }
  if (d.description !== undefined) {
    sets.push(`description = $${idx++}`);
    values.push(d.description);
  }
  if (d.basePriceHalire !== undefined) {
    sets.push(`base_price_halire = $${idx++}`);
    values.push(d.basePriceHalire);
  }
  if (d.capacity !== undefined) {
    sets.push(`capacity = $${idx++}`);
    values.push(d.capacity);
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    // RLS bypass — ownership ověřena v assertOwnership výš.
    await client.query(`SET LOCAL app.is_platform_admin = 'true'`);

    if (sets.length > 0) {
      sets.push(`updated_at = NOW()`);
      values.push(params.id);
      await client.query(
        `UPDATE subscriptions.packages SET ${sets.join(', ')} WHERE id = $${idx}`,
        values,
      );
    }

    if (d.eventIds !== undefined) {
      await client.query(
        `DELETE FROM subscriptions.package_events WHERE package_id = $1`,
        [params.id],
      );
      if (d.eventIds.length > 0) {
        const vals = d.eventIds.map((_, i) => `($1, $${i + 2}, ${i})`).join(', ');
        await client.query(
          `INSERT INTO subscriptions.package_events (package_id, event_id, order_index)
           VALUES ${vals} ON CONFLICT DO NOTHING`,
          [params.id, ...d.eventIds],
        );
      }
    }

    await client.query('COMMIT');
    return NextResponse.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PATCH /api/admin/subscriptions/packages/[id]]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }
}
