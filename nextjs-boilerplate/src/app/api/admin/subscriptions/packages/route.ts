/**
 * GET  /api/admin/subscriptions/packages       — list abonentek promotéra
 * POST /api/admin/subscriptions/packages       — vytvoření nové
 *
 * Auth: requirePromoter.
 *
 * POST body: {
 *   name, slug, seasonLabel, basePriceHalire, currency,
 *   category?, description?, venueId?, earlyBirdUntil?, earlyBirdPriceHalire?,
 *   saleStart?, saleEnd?, capacity?, autoRenewable?, eventIds?
 * }
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter, runAsPromoterNonStaff } from '@/lib/admin-auth';
import { z } from 'zod';


const postSchema = z
  .object({
    name: z.string().min(2).max(200),
    slug: z.string().regex(/^[a-z0-9-]{2,80}$/),
    seasonLabel: z.string().min(2).max(20),
    basePriceHalire: z.number().int().positive(),
    currency: z.string().length(3).default('CZK'),
    category: z.enum(['theater', 'concert_series', 'dance', 'children', 'other']).default('theater'),
    description: z.string().max(2000).optional(),
    venueId: z.string().uuid().optional(),
    earlyBirdUntil: z.string().datetime().optional(),
    earlyBirdPriceHalire: z.number().int().positive().optional(),
    saleStart: z.string().datetime().optional(),
    saleEnd: z.string().datetime().optional(),
    capacity: z.number().int().positive().optional(),
    autoRenewable: z.boolean().default(true),
    eventIds: z.array(z.string().uuid()).optional(),
    // DACH parity #P0-2: Wahl-Abo support
    aboType: z.enum(['fixed', 'choice']).default('fixed'),
    maxPicksForChoice: z.number().int().min(1).max(365).optional(),
  })
  .refine(
    (d) => d.aboType !== 'choice' || (d.maxPicksForChoice !== undefined && d.maxPicksForChoice > 0),
    {
      message: 'maxPicksForChoice is required when aboType=choice',
      path: ['maxPicksForChoice'],
    },
  )
  .refine(
    (d) =>
      d.aboType !== 'choice' ||
      d.eventIds === undefined ||
      d.maxPicksForChoice! <= d.eventIds.length,
    {
      message: 'maxPicksForChoice cannot exceed number of events in package',
      path: ['maxPicksForChoice'],
    },
  );

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const r = await db().query<{
    id: string;
    name: string;
    slug: string;
    season_label: string;
    category: string;
    base_price_halire: number;
    currency: string;
    status: string;
    sale_start: string;
    sale_end: string | null;
    capacity: number | null;
    abo_type: string;
    max_picks_for_choice: number | null;
    events_count: string;
    holders_count: string;
    created_at: string;
  }>(
    `SELECT p.id, p.name, p.slug, p.season_label, p.category,
            p.base_price_halire, p.currency, p.status,
            p.sale_start::text, p.sale_end::text,
            p.capacity, p.abo_type, p.max_picks_for_choice,
            (SELECT COUNT(*)::text FROM subscriptions.package_events
               WHERE package_id = p.id) AS events_count,
            (SELECT COUNT(*)::text FROM subscriptions.holders
               WHERE package_id = p.id AND status = 'active') AS holders_count,
            p.created_at::text
       FROM subscriptions.packages p
      WHERE p.promoter_id = $1
      ORDER BY p.created_at DESC
      LIMIT 200`,
    [promoter.promoterId],
  );

  return NextResponse.json({
    packages: r.rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      seasonLabel: row.season_label,
      category: row.category,
      basePriceHalire: row.base_price_halire,
      currency: row.currency,
      status: row.status,
      saleStart: row.sale_start,
      saleEnd: row.sale_end,
      capacity: row.capacity,
      aboType: row.abo_type,
      maxPicksForChoice: row.max_picks_for_choice,
      eventsCount: Number(row.events_count),
      holdersCount: Number(row.holders_count),
      createdAt: row.created_at,
    })),
  });

  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
  }
  const d = parsed.data;

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    const r = await client.query<{ id: string }>(
      `INSERT INTO subscriptions.packages
         (promoter_id, venue_id, name, slug, description, season_label, category,
          base_price_halire, currency,
          early_bird_until, early_bird_price_halire,
          sale_start, sale_end, capacity, auto_renewable,
          abo_type, max_picks_for_choice)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               COALESCE($12::timestamptz, NOW()), $13::timestamptz, $14, $15,
               $16, $17)
       RETURNING id`,
      [
        promoter.promoterId,
        d.venueId ?? null,
        d.name,
        d.slug,
        d.description ?? null,
        d.seasonLabel,
        d.category,
        d.basePriceHalire,
        d.currency,
        d.earlyBirdUntil ?? null,
        d.earlyBirdPriceHalire ?? null,
        d.saleStart ?? null,
        d.saleEnd ?? null,
        d.capacity ?? null,
        d.autoRenewable,
        d.aboType,
        d.aboType === 'choice' ? d.maxPicksForChoice : null,
      ],
    );
    const packageId = r.rows[0].id;

    // Bulk insert event associations
    if (d.eventIds && d.eventIds.length > 0) {
      const values = d.eventIds
        .map((_, i) => `($1, $${i + 2}, ${i})`)
        .join(', ');
      await client.query(
        `INSERT INTO subscriptions.package_events (package_id, event_id, order_index)
         VALUES ${values}
         ON CONFLICT DO NOTHING`,
        [packageId, ...d.eventIds],
      );
    }

    await client.query('COMMIT');
    return NextResponse.json({ id: packageId, slug: d.slug }, { status: 201 });
  } catch (err) {
    await client.query('ROLLBACK');
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('duplicate key')) {
      return NextResponse.json({ error: 'SLUG_TAKEN', message: 'Tato slug už existuje pro tohoto promotéra' }, { status: 409 });
    }
    console.error('[POST /api/admin/subscriptions/packages]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
