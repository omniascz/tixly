/**
 * GET  /api/admin/events/[id]/entry-slots   — list všech slotů
 * POST /api/admin/events/[id]/entry-slots   — bulk generator slotů z range
 *
 * Body POST:
 *   { startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD',
 *     dailyStart: 'HH:MM', dailyEnd: 'HH:MM',
 *     slotDurationMinutes: 60, bufferMinutes: 0,
 *     capacityPerSlot: 30,
 *     daysOfWeek?: [0,1,2,3,4,5,6] // 0=Sun, 6=Sat. Default = všechny.
 *     excludeDates?: ['YYYY-MM-DD', ...] }
 *
 * Vrátí počet vytvořených slotů a první/poslední.
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

const generateSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dailyStart: z.string().regex(/^\d{2}:\d{2}$/),
  dailyEnd: z.string().regex(/^\d{2}:\d{2}$/),
  slotDurationMinutes: z.number().int().min(10).max(480),
  bufferMinutes: z.number().int().min(0).max(120).default(0),
  capacityPerSlot: z.number().int().min(1).max(10000),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  excludeDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(366).optional(),
});

async function ownsEvent(eventId: string, promoterId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return false;
  const r = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM catalog.events
     WHERE id = $1 AND promoter_id = $2`,
    [eventId, promoterId],
  );
  return Number(r.rows[0]?.count ?? 0) > 0;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await ownsEvent(params.id, promoter.promoterId))) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const r = await db().query(
    `SELECT id, slot_start, slot_end, capacity, remaining, status, created_at
     FROM catalog.entry_slots
     WHERE event_id = $1
     ORDER BY slot_start ASC`,
    [params.id],
  );
  return NextResponse.json({ eventId: params.id, slots: r.rows });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await ownsEvent(params.id, promoter.promoterId))) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = generateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BAD_INPUT', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const inp = parsed.data;

  const start = new Date(inp.startDate + 'T00:00:00Z');
  const end = new Date(inp.endDate + 'T23:59:59Z');
  if (end < start) {
    return NextResponse.json({ error: 'INVALID_RANGE' }, { status: 422 });
  }

  const [startH, startM] = inp.dailyStart.split(':').map(Number) as [number, number];
  const [endH, endM] = inp.dailyEnd.split(':').map(Number) as [number, number];
  const dailyStartMin = startH * 60 + startM;
  const dailyEndMin = endH * 60 + endM;
  if (dailyEndMin <= dailyStartMin) {
    return NextResponse.json({ error: 'INVALID_DAILY_RANGE' }, { status: 422 });
  }

  const exclude = new Set(inp.excludeDates ?? []);
  const daysOfWeek = new Set(inp.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6]);

  const client = await db().connect();
  let created = 0;
  let firstSlot: string | null = null;
  let lastSlot: string | null = null;
  try {
    await client.query('BEGIN');
    // Aktivuj timed_entry na eventu
    await client.query(
      `UPDATE catalog.events SET timed_entry_enabled = TRUE, updated_at = NOW() WHERE id = $1`,
      [params.id],
    );

    for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400_000)) {
      const dateStr = d.toISOString().slice(0, 10);
      if (exclude.has(dateStr)) continue;
      if (!daysOfWeek.has(d.getUTCDay())) continue;

      const stepMin = inp.slotDurationMinutes + inp.bufferMinutes;
      for (
        let minOfDay = dailyStartMin;
        minOfDay + inp.slotDurationMinutes <= dailyEndMin;
        minOfDay += stepMin
      ) {
        const slotStartUtc = new Date(d.getTime() + minOfDay * 60_000);
        const slotEndUtc = new Date(slotStartUtc.getTime() + inp.slotDurationMinutes * 60_000);

        await client.query(
          `INSERT INTO catalog.entry_slots
             (event_id, slot_start, slot_end, capacity, remaining)
           VALUES ($1, $2, $3, $4, $4)
           ON CONFLICT (event_id, slot_start) DO NOTHING`,
          [params.id, slotStartUtc.toISOString(), slotEndUtc.toISOString(), inp.capacityPerSlot],
        );
        created += 1;
        if (!firstSlot) firstSlot = slotStartUtc.toISOString();
        lastSlot = slotStartUtc.toISOString();
      }
    }

    await client.query('COMMIT');
    return NextResponse.json({
      ok: true,
      eventId: params.id,
      attempted: created,
      firstSlot,
      lastSlot,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST entry-slots]', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  } finally {
    client.release();
  }
}
