/**
 * PATCH  /api/admin/events/[id]/rfid/devices/[deviceId]
 * DELETE /api/admin/events/[id]/rfid/devices/[deviceId]
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  zoneId: z.string().uuid().nullable().optional(),
  direction: z.enum(['in', 'out', 'both']).optional(),
  active: z.boolean().optional(),
});

async function assertEventOwner(eventId: string, promoterId: string): Promise<boolean> {
  const r = await db().query(
    `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2 LIMIT 1`,
    [eventId, promoterId],
  );
  return r.rows.length > 0;
}

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string; deviceId: string }> }
): Promise<Response> {
  const params = await props.params;
  return runAsPromoter(req, async (ctx) => {
    if (!(await assertEventOwner(params.id, ctx.promoterId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Validation failed' }, { status: 422 });
    const d = parsed.data;
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (d.name !== undefined)     { fields.push(`name = $${i++}`);      values.push(d.name); }
    if ('zoneId' in d)            { fields.push(`zone_id = $${i++}`);   values.push(d.zoneId ?? null); }
    if (d.direction !== undefined) { fields.push(`direction = $${i++}`); values.push(d.direction); }
    if (d.active !== undefined)   { fields.push(`active = $${i++}`);    values.push(d.active); }
    if (fields.length === 0) return NextResponse.json({ error: 'No fields' }, { status: 400 });
    const r = await db().query(
      `UPDATE catalog.rfid_devices SET ${fields.join(', ')}
       WHERE id = $${i++} AND event_id = $${i} RETURNING *`,
      [...values, params.deviceId, params.id],
    );
    if (r.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(r.rows[0]);
  });
}

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ id: string; deviceId: string }> }
): Promise<Response> {
  const params = await props.params;
  return runAsPromoter(req, async (ctx) => {
    if (!(await assertEventOwner(params.id, ctx.promoterId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    await db().query(
      `DELETE FROM catalog.rfid_devices WHERE id = $1 AND event_id = $2`,
      [params.deviceId, params.id],
    );
    return NextResponse.json({ ok: true });
  });
}
