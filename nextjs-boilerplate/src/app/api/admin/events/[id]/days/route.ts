/**
 * GET  /api/admin/events/[id]/days — list všech dnů sezóny
 * POST /api/admin/events/[id]/days — přidat den (zápas, představení, lekce)
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

interface DayRow {
  id: string;
  day_index: number;
  starts_at: string;
  ends_at: string;
  label: string | null;
  notes: string | null;
  redemption_count: number;
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
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await ensureOwnership(params.id, promoter.promoterId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const r = await db().query<DayRow>(
    `SELECT d.id, d.day_index, d.starts_at, d.ends_at, d.label, d.notes,
            (SELECT COUNT(*)::int FROM tickets.ticket_redemptions r WHERE r.event_day_id = d.id) AS redemption_count
     FROM catalog.event_days d
     WHERE d.event_id = $1
     ORDER BY d.day_index, d.starts_at`,
    [params.id],
  );
  return NextResponse.json({
    days: r.rows.map((d) => ({
      id: d.id,
      dayIndex: d.day_index,
      startsAt: d.starts_at,
      endsAt: d.ends_at,
      label: d.label,
      notes: d.notes,
      redemptionCount: d.redemption_count,
    })),
  });
}

const createSchema = z.object({
  label: z.string().max(200).nullable().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  notes: z.string().max(1000).nullable().optional(),
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
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;
  if (new Date(input.endsAt) <= new Date(input.startsAt)) {
    return NextResponse.json({ error: 'endsAt must be after startsAt' }, { status: 422 });
  }

  // day_index = max + 1
  const maxRes = await db().query<{ next: number }>(
    `SELECT COALESCE(MAX(day_index), -1) + 1 AS next FROM catalog.event_days WHERE event_id = $1`,
    [params.id],
  );
  const nextIndex = Number(maxRes.rows[0]?.next ?? 0);

  const r = await db().query<{ id: string }>(
    `INSERT INTO catalog.event_days (event_id, day_index, starts_at, ends_at, label, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      params.id,
      nextIndex,
      input.startsAt,
      input.endsAt,
      input.label ?? null,
      input.notes ?? null,
    ],
  );
  return NextResponse.json({ id: r.rows[0].id, dayIndex: nextIndex }, { status: 201 });
}
