/**
 * GET  /api/admin/events/[id]/access-matrix
 *   → vrátí ticket_types + event_days + event_zones + existing access matrix
 *
 * PUT /api/admin/events/[id]/access-matrix
 *   body: { entries: [{ ticketTypeId, dayId | 'all', zoneId | 'all', level }] }
 *   → DELETE all + bulk INSERT (full replace)
 *
 * Promotér edituje access matrix existing eventu — wizard v /admin/events/new
 * to umí jen při vytvoření, tento endpoint dokrývá post-create úpravy.
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

const ACCESS_LEVELS = ['general', 'premium', 'vip', 'backstage', 'accessibility'] as const;

const entrySchema = z.object({
  ticketTypeId: z.string().uuid(),
  dayId: z.union([z.string().uuid(), z.literal('all')]),
  zoneId: z.union([z.string().uuid(), z.literal('all')]),
  level: z.enum(ACCESS_LEVELS),
});

const putSchema = z.object({
  entries: z.array(entrySchema).max(2000),
});

async function ownsEvent(
  client: { query: (text: string, params?: unknown[]) => Promise<{ rows: Array<{ promoter_id: string }> }> },
  eventId: string,
  promoterId: string,
): Promise<boolean> {
  const r = await client.query(
    `SELECT promoter_id FROM catalog.events WHERE id = $1`,
    [eventId],
  );
  return r.rows.length > 0 && r.rows[0].promoter_id === promoterId;
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

  const client = await db().connect();
  try {
    if (!(await ownsEvent(client, params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const tts = await client.query<{
      id: string;
      name: string;
      base_price: number;
    }>(
      `SELECT id, name, base_price FROM catalog.ticket_types
        WHERE event_id = $1 ORDER BY base_price`,
      [params.id],
    );

    const days = await client.query<{
      id: string;
      day_index: number;
      label: string | null;
      starts_at: string;
    }>(
      `SELECT id, day_index, label, starts_at::text
         FROM catalog.event_days WHERE event_id = $1
        ORDER BY day_index`,
      [params.id],
    );

    const zones = await client.query<{
      id: string;
      name: string;
      zone_type: string;
      capacity: number | null;
    }>(
      `SELECT id, name, zone_type, capacity
         FROM catalog.event_zones WHERE event_id = $1
        ORDER BY display_order, name`,
      [params.id],
    );

    const access = await client.query<{
      id: string;
      ticket_type_id: string;
      event_day_id: string | null;
      zone_id: string | null;
      access_level: string;
    }>(
      `SELECT a.id, a.ticket_type_id, a.event_day_id, a.zone_id, a.access_level
         FROM catalog.ticket_type_access a
         JOIN catalog.ticket_types tt ON tt.id = a.ticket_type_id
        WHERE tt.event_id = $1
        ORDER BY a.ticket_type_id`,
      [params.id],
    );

    return NextResponse.json({
      ticketTypes: tts.rows,
      days: days.rows,
      zones: zones.rows,
      access: access.rows,
    });
  } finally {
    client.release();
  }
}

export async function PUT(
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
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_BODY', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    if (!(await ownsEvent(client, params.id, promoter.promoterId))) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Resolve ticket types for this event (ownership + FK sanity)
    const ttRes = await client.query<{ id: string }>(
      `SELECT id FROM catalog.ticket_types WHERE event_id = $1`,
      [params.id],
    );
    const validTtIds = new Set(ttRes.rows.map((r) => r.id));

    // Delete existing rows for these ticket_types (full replace semantics)
    if (validTtIds.size > 0) {
      await client.query(
        `DELETE FROM catalog.ticket_type_access WHERE ticket_type_id = ANY($1::uuid[])`,
        [Array.from(validTtIds)],
      );
    }

    // Bulk insert new entries — wildcard 'all' → NULL
    let inserted = 0;
    for (const e of parsed.data.entries) {
      if (!validTtIds.has(e.ticketTypeId)) continue; // ignore foreign ticket types
      await client.query(
        `INSERT INTO catalog.ticket_type_access
           (ticket_type_id, event_day_id, zone_id, access_level)
         VALUES ($1, $2, $3, $4)`,
        [
          e.ticketTypeId,
          e.dayId === 'all' ? null : e.dayId,
          e.zoneId === 'all' ? null : e.zoneId,
          e.level,
        ],
      );
      inserted += 1;
    }

    await client.query('COMMIT');
    return NextResponse.json({ ok: true, inserted });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[PUT access-matrix]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }
}
