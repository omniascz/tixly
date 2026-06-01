/**
 * GET    /api/admin/events/[id]/holds       — list všech non-customer hold-ů na event
 * POST   /api/admin/events/[id]/holds       — bulk vytvoření holdu pro seatIds
 * DELETE /api/admin/events/[id]/holds       — bulk release (z seatIds nebo whole kind)
 *
 * Body POST: { seatIds: [...], kind: 'artist'|'promoter'|'comp'|'production', label?, releaseAt? }
 * Body DELETE: { seatIds?: [...], kind?: 'artist'|... } (jedno z nich)
 *
 * Ownership: promotér musí vlastnit event. Buyer holds (kind='customer') tento endpoint
 * nemůže ovlivnit — má vlastní /api/events/[id]/seats/hold.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';


const HOLD_KINDS = ['artist', 'promoter', 'comp', 'production'] as const;

const postSchema = z.object({
  seatIds: z.array(z.string().uuid()).min(1).max(1000),
  kind: z.enum(HOLD_KINDS),
  label: z.string().max(120).optional(),
  releaseAt: z.string().datetime().optional(),
});

const deleteSchema = z.object({
  seatIds: z.array(z.string().uuid()).max(1000).optional(),
  kind: z.enum(HOLD_KINDS).optional(),
}).refine((d) => Boolean(d.seatIds?.length) || Boolean(d.kind), {
  message: 'Specify seatIds or kind',
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
  return runAsActivePromoter(req, async (promoter) => {
  if (!(await ownsEvent(params.id, promoter.promoterId))) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const r = await db().query<{
    id: string;
    sector: string;
    row: string;
    seat_number: string;
    hold_kind: string;
    hold_label: string | null;
    hold_until: string | null;
  }>(
    `SELECT id, sector, row, seat_number, hold_kind, hold_label, hold_until
     FROM catalog.event_seats
     WHERE event_id = $1 AND hold_kind IS NOT NULL AND hold_kind <> 'customer'
     ORDER BY hold_kind, sector, row, seat_number`,
    [params.id],
  );

  const counts: Record<string, number> = {};
  for (const row of r.rows) {
    counts[row.hold_kind] = (counts[row.hold_kind] ?? 0) + 1;
  }

  return NextResponse.json({
    eventId: params.id,
    totalsByKind: counts,
    holds: r.rows.map((s) => ({
      seatId: s.id,
      sector: s.sector,
      row: s.row,
      seatNumber: s.seat_number,
      kind: s.hold_kind,
      label: s.hold_label,
      releaseAt: s.hold_until,
    })),
  });

  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
  if (!(await ownsEvent(params.id, promoter.promoterId))) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BAD_INPUT', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    const upd = await client.query<{ id: string }>(
      `UPDATE catalog.event_seats
       SET status = 'held',
           hold_kind = $3,
           hold_label = $4,
           hold_until = $5,
           updated_at = NOW()
       WHERE event_id = $1
         AND id = ANY($2::uuid[])
         AND status IN ('available', 'held')
         AND (hold_kind IS NULL OR hold_kind = 'customer')
       RETURNING id`,
      [
        params.id,
        parsed.data.seatIds,
        parsed.data.kind,
        parsed.data.label ?? null,
        parsed.data.releaseAt ?? null,
      ],
    );

    await client.query(
      `INSERT INTO audit.audit_log
         (schema_name, table_name, record_id, action, actor_id, actor_type, new_values)
       VALUES ('catalog', 'event_seats', $1, 'UPDATE', $2, 'user', $3::jsonb)`,
      [
        params.id,
        promoter.userId,
        JSON.stringify({
          kind: 'seat_hold_create',
          hold_kind: parsed.data.kind,
          label: parsed.data.label ?? null,
          release_at: parsed.data.releaseAt ?? null,
          seat_count: upd.rows.length,
          requested: parsed.data.seatIds.length,
        }),
      ],
    );

    await client.query('COMMIT');
    return NextResponse.json({
      ok: true,
      held: upd.rows.length,
      requested: parsed.data.seatIds.length,
      skipped: parsed.data.seatIds.length - upd.rows.length,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST holds]', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
  if (!(await ownsEvent(params.id, promoter.promoterId))) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BAD_INPUT', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const args: unknown[] = [params.id];
  let whereExtra = '';
  if (parsed.data.seatIds && parsed.data.seatIds.length > 0) {
    args.push(parsed.data.seatIds);
    whereExtra += ` AND id = ANY($${args.length}::uuid[])`;
  }
  if (parsed.data.kind) {
    args.push(parsed.data.kind);
    whereExtra += ` AND hold_kind = $${args.length}`;
  } else {
    whereExtra += ` AND hold_kind IS NOT NULL AND hold_kind <> 'customer'`;
  }

  const r = await db().query<{ id: string }>(
    `UPDATE catalog.event_seats
     SET status = 'available',
         hold_kind = NULL,
         hold_label = NULL,
         hold_until = NULL,
         updated_at = NOW()
     WHERE event_id = $1 ${whereExtra}
     RETURNING id`,
    args,
  );

  return NextResponse.json({ ok: true, released: r.rows.length });

  });
}
