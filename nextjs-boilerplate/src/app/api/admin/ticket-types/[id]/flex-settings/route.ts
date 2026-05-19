/**
 * GET  /api/admin/ticket-types/[id]/flex-settings
 * PUT  /api/admin/ticket-types/[id]/flex-settings — upsert
 * DELETE /api/admin/ticket-types/[id]/flex-settings
 *
 * Flex pass setting určuje, jaký typ permanentky to je:
 *   - flex   = kupec si vybírá termíny (Vyber 6 z 12 představení)
 *   - season = ticket platí na všechny dni automaticky
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

async function ensureOwnership(
  ticketTypeId: string,
  promoterId: string,
): Promise<{ ttId: string; eventId: string } | null> {
  const r = await db().query<{ id: string; event_id: string }>(
    `SELECT tt.id, tt.event_id
     FROM catalog.ticket_types tt
     JOIN catalog.events e ON e.id = tt.event_id
     WHERE tt.id = $1 AND e.promoter_id = $2`,
    [ticketTypeId, promoterId],
  );
  if (r.rows.length === 0) return null;
  return { ttId: r.rows[0]!.id, eventId: r.rows[0]!.event_id };
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
  const r = await db().query<{
    picks_required: number;
    pass_kind: string;
    pick_deadline: string | null;
    notes: string | null;
  }>(
    `SELECT picks_required, pass_kind, pick_deadline, notes
     FROM catalog.flex_pass_settings WHERE ticket_type_id = $1`,
    [params.id],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ exists: false });
  }
  const s = r.rows[0]!;
  return NextResponse.json({
    exists: true,
    picksRequired: s.picks_required,
    passKind: s.pass_kind,
    pickDeadline: s.pick_deadline,
    notes: s.notes,
  });
}

const upsertSchema = z.object({
  picksRequired: z.number().int().min(1).max(365),
  passKind: z.enum(['flex', 'season']).default('flex'),
  pickDeadline: z.string().datetime().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export async function PUT(
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
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;
  await db().query(
    `INSERT INTO catalog.flex_pass_settings
       (ticket_type_id, picks_required, pass_kind, pick_deadline, notes)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (ticket_type_id) DO UPDATE SET
       picks_required = EXCLUDED.picks_required,
       pass_kind = EXCLUDED.pass_kind,
       pick_deadline = EXCLUDED.pick_deadline,
       notes = EXCLUDED.notes,
       updated_at = NOW()`,
    [
      params.id,
      input.picksRequired,
      input.passKind,
      input.pickDeadline ?? null,
      input.notes ?? null,
    ],
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(
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
  await db().query(
    `DELETE FROM catalog.flex_pass_settings WHERE ticket_type_id = $1`,
    [params.id],
  );
  return NextResponse.json({ ok: true });
}
