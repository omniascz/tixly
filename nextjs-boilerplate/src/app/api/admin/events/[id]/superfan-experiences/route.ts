/**
 * GET  /api/admin/events/[id]/superfan-experiences — list zážitků
 * POST /api/admin/events/[id]/superfan-experiences — create
 * PATCH /api/admin/events/[id]/superfan-experiences?expId= — update/deactivate
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

const UUID_RE = /^[0-9a-f-]{36}$/i;

const schema = z.object({
  name: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
  type: z.enum(['meet_greet', 'soundcheck', 'backstage_tour', 'vip_lounge', 'after_party'])
    .default('meet_greet'),
  capacity: z.number().int().min(1).max(500).default(10),
  priceHalire: z.number().int().min(0),
  currency: z.string().length(3).default('CZK'),
  requiresTicket: z.boolean().default(true),
  startTime: z.string().datetime({ offset: true }).optional(),
  location: z.string().max(200).optional(),
  whatToExpect: z.string().max(3000).optional(),
  coverImageUrl: z.string().url().max(500).optional(),
  bookingDeadline: z.string().datetime({ offset: true }).optional(),
});

const patchSchema = z.object({
  active: z.boolean().optional(),
  capacity: z.number().int().min(1).optional(),
  priceHalire: z.number().int().min(0).optional(),
  description: z.string().max(2000).optional(),
});

async function assertOwner(eventId: string, promoterId: string) {
  const r = await db().query(
    `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
    [eventId, promoterId],
  );
  return r.rows.length > 0;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return runAsActivePromoter(req, async (p) => {
    if (!(await assertOwner(params.id, p.promoterId)))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const r = await db().query(
      `SELECT * FROM catalog.superfan_experiences WHERE event_id = $1 ORDER BY created_at DESC`,
      [params.id],
    );
    return NextResponse.json({ experiences: r.rows });
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return runAsActivePromoter(req, async (p) => {
    if (!(await assertOwner(params.id, p.promoterId)))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json({ error: 'BAD_INPUT', issues: parsed.error.issues }, { status: 422 });
    const d = parsed.data;
    const r = await db().query<{ id: string }>(
      `INSERT INTO catalog.superfan_experiences
         (event_id, name, description, type, capacity, price_halire, currency, requires_ticket,
          start_time, location, what_to_expect, cover_image_url, booking_deadline)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [params.id, d.name, d.description ?? null, d.type, d.capacity, d.priceHalire,
       d.currency, d.requiresTicket, d.startTime ?? null, d.location ?? null,
       d.whatToExpect ?? null, d.coverImageUrl ?? null, d.bookingDeadline ?? null],
    );
    return NextResponse.json({ ok: true, id: r.rows[0].id }, { status: 201 });
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return runAsActivePromoter(req, async (p) => {
    if (!(await assertOwner(params.id, p.promoterId)))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const expId = req.nextUrl.searchParams.get('expId');
    if (!expId || !UUID_RE.test(expId))
      return NextResponse.json({ error: 'expId required' }, { status: 422 });
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json({ error: 'BAD_INPUT', issues: parsed.error.issues }, { status: 422 });
    const sets: string[] = ['updated_at = NOW()'];
    const vals: unknown[] = [expId, params.id];
    let p2 = 3;
    if (parsed.data.active !== undefined) { sets.push(`active = $${p2++}`); vals.push(parsed.data.active); }
    if (parsed.data.capacity !== undefined) { sets.push(`capacity = $${p2++}`); vals.push(parsed.data.capacity); }
    if (parsed.data.priceHalire !== undefined) { sets.push(`price_halire = $${p2++}`); vals.push(parsed.data.priceHalire); }
    if (parsed.data.description !== undefined) { sets.push(`description = $${p2++}`); vals.push(parsed.data.description); }
    await db().query(
      `UPDATE catalog.superfan_experiences SET ${sets.join(', ')} WHERE id = $1 AND event_id = $2`,
      vals,
    );
    return NextResponse.json({ ok: true });
  });
}
