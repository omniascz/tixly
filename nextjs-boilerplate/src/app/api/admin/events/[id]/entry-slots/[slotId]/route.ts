/**
 * PATCH /api/admin/events/[id]/entry-slots/[slotId]
 *   Upravit kapacitu, status (open/cancelled), pozici slotu.
 * DELETE /api/admin/events/[id]/entry-slots/[slotId]
 *   Smazat slot pokud remaining = capacity (nikdo nekoupil).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';
import { z } from 'zod';

const patchSchema = z.object({
  status: z.enum(['open', 'cancelled', 'sold_out']).optional(),
  capacity: z.number().int().min(1).max(100000).optional(),
  notes: z.string().max(200).optional().nullable(),
});

async function ownsSlot(slotId: string, eventId: string, promoterId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(slotId) || !/^[0-9a-f-]{36}$/i.test(eventId)) return false;
  const r = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM catalog.entry_slots es
     JOIN catalog.events e ON e.id = es.event_id
     WHERE es.id = $1 AND es.event_id = $2 AND e.promoter_id = $3`,
    [slotId, eventId, promoterId],
  );
  return Number(r.rows[0]?.count ?? 0) > 0;
}

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string; slotId: string }> }
): Promise<Response> {
  const params = await props.params;
  return runAsPromoter(req, async (promoter) => {
    if (!(await ownsSlot(params.slotId, params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'BAD_INPUT', issues: parsed.error.issues }, { status: 422 });
    }
    const inp = parsed.data;

    const fields: string[] = [];
    const vals: unknown[] = [];
    let i = 1;

    if (inp.status !== undefined) {
      fields.push(`status=$${i++}`);
      vals.push(inp.status);
    }
    if (inp.capacity !== undefined) {
      // Kapacita nesmí klesnout pod already sold (capacity - remaining = sold)
      const sold = await db().query<{ sold: number }>(
        `SELECT (capacity - remaining) AS sold FROM catalog.entry_slots WHERE id=$1`,
        [params.slotId],
      );
      const soldCount = sold.rows[0]?.sold ?? 0;
      if (inp.capacity < soldCount) {
        return NextResponse.json(
          { error: 'CAPACITY_BELOW_SOLD', sold: soldCount },
          { status: 422 },
        );
      }
      // Přepočítej remaining = new capacity - sold
      const newRemaining = inp.capacity - soldCount;
      fields.push(`capacity=$${i++}`, `remaining=$${i++}`);
      vals.push(inp.capacity, newRemaining);
    }
    if (inp.notes !== undefined) {
      fields.push(`notes=$${i++}`);
      vals.push(inp.notes);
    }

    if (fields.length === 0) {
      return NextResponse.json({ error: 'NOTHING_TO_UPDATE' }, { status: 400 });
    }

    fields.push(`updated_at=NOW()`);
    vals.push(params.slotId);
    const r = await db().query(
      `UPDATE catalog.entry_slots SET ${fields.join(',')} WHERE id=$${i} RETURNING *`,
      vals,
    );
    return NextResponse.json({ slot: r.rows[0] });
  });
}

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ id: string; slotId: string }> }
): Promise<Response> {
  const params = await props.params;
  return runAsPromoter(req, async (promoter) => {
    if (!(await ownsSlot(params.slotId, params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    // Smazat jen pokud nikdo nekoupil
    const check = await db().query<{ remaining: number; capacity: number }>(
      `SELECT remaining, capacity FROM catalog.entry_slots WHERE id=$1`,
      [params.slotId],
    );
    if (check.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    const slot = check.rows[0];
    if (slot.remaining < slot.capacity) {
      return NextResponse.json(
        { error: 'SLOT_HAS_SALES', sold: slot.capacity - slot.remaining },
        { status: 409 },
      );
    }

    await db().query(`DELETE FROM catalog.entry_slots WHERE id=$1`, [params.slotId]);
    return NextResponse.json({ ok: true });
  });
}
