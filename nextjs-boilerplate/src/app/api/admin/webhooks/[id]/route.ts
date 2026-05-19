/**
 * PATCH  /api/admin/webhooks/[id] — edit (url, description, events, is_active)
 * DELETE /api/admin/webhooks/[id] — odebrat endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';
import { WEBHOOK_EVENT_TYPES } from '@/lib/webhooks/event-types';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const PatchSchema = z.object({
  url: z.string().url().max(500).optional(),
  description: z.string().max(200).optional(),
  events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  }
  const body: unknown = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid', issues: parsed.error.issues }, { status: 422 });
  }
  const d = parsed.data;
  const sets: string[] = [];
  const args: unknown[] = [];
  let p = 1;
  if (d.url !== undefined) {
    sets.push(`url = $${p++}`);
    args.push(d.url);
  }
  if (d.description !== undefined) {
    sets.push(`description = $${p++}`);
    args.push(d.description);
  }
  if (d.events !== undefined) {
    sets.push(`events = $${p++}::text[]`);
    args.push(d.events);
  }
  if (d.isActive !== undefined) {
    sets.push(`is_active = $${p++}`);
    args.push(d.isActive);
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: 'No fields' }, { status: 400 });
  }
  args.push(id, promoter.promoterId);
  const r = await db().query(
    `UPDATE reservations.webhook_endpoints
     SET ${sets.join(', ')}
     WHERE id = $${p++} AND promoter_id = $${p++}
     RETURNING id`,
    args,
  );
  if (r.rowCount === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  }
  const r = await db().query(
    `DELETE FROM reservations.webhook_endpoints
     WHERE id = $1 AND promoter_id = $2 RETURNING id`,
    [id, promoter.promoterId],
  );
  if (r.rowCount === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
