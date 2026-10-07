/**
 * GET  /api/admin/events/[id]/rfid/devices
 * POST /api/admin/events/[id]/rfid/devices
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().min(1).max(100),
  zoneId: z.string().uuid().nullable().optional(),
  direction: z.enum(['in', 'out', 'both']).optional().default('in'),
});

async function assertEventOwner(eventId: string, promoterId: string): Promise<boolean> {
  const r = await db().query(
    `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2 LIMIT 1`,
    [eventId, promoterId],
  );
  return r.rows.length > 0;
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsPromoter(req, async (ctx) => {
    if (!(await assertEventOwner(params.id, ctx.promoterId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const r = await db().query(
      `SELECT d.id, d.name, d.zone_id, z.name AS zone_name, d.direction,
              d.api_key, d.active, d.last_seen_at, d.created_at
       FROM catalog.rfid_devices d
       LEFT JOIN catalog.rfid_zones z ON z.id = d.zone_id
       WHERE d.event_id = $1
       ORDER BY d.created_at`,
      [params.id],
    );
    return NextResponse.json({ devices: r.rows });
  });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsPromoter(req, async (ctx) => {
    if (!(await assertEventOwner(params.id, ctx.promoterId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
    }
    const d = parsed.data;
    const apiKey = `tixly_rfid_${randomBytes(24).toString('hex')}`;
    const r = await db().query(
      `INSERT INTO catalog.rfid_devices (event_id, zone_id, name, direction, api_key)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, zone_id, direction, api_key, active, created_at`,
      [params.id, d.zoneId ?? null, d.name, d.direction, apiKey],
    );
    return NextResponse.json(r.rows[0], { status: 201 });
  });
}
