/**
 * GET  /api/admin/events/[id]/rfid/zones — list zón + aktuální obsazenost
 * POST /api/admin/events/[id]/rfid/zones — vytvořit zónu
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(10).toUpperCase(),
  capacity: z.number().int().positive().nullable().optional(),
  antiPassback: z.boolean().optional().default(true),
  allowedTicketTypeIds: z.array(z.string().uuid()).nullable().optional(),
  sortOrder: z.number().int().optional().default(0),
});

async function assertEventOwner(eventId: string, promoterId: string): Promise<boolean> {
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
  return runAsPromoter(req, async (ctx) => {
    if (!(await assertEventOwner(params.id, ctx.promoterId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const r = await db().query(
      `SELECT z.id, z.name, z.code, z.capacity, z.anti_passback, z.allowed_ticket_type_ids,
              z.sort_order, z.created_at,
              COALESCE(p.count, 0)::int AS current_occupancy
       FROM catalog.rfid_zones z
       LEFT JOIN (
         SELECT zone_id, COUNT(*) AS count FROM catalog.rfid_presence GROUP BY zone_id
       ) p ON p.zone_id = z.id
       WHERE z.event_id = $1
       ORDER BY z.sort_order, z.created_at`,
      [params.id],
    );
    return NextResponse.json({ zones: r.rows });
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
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
    const r = await db().query(
      `INSERT INTO catalog.rfid_zones
         (event_id, name, code, capacity, anti_passback, allowed_ticket_type_ids, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [params.id, d.name, d.code, d.capacity ?? null, d.antiPassback, d.allowedTicketTypeIds ?? null, d.sortOrder],
    );
    return NextResponse.json(r.rows[0], { status: 201 });
  });
}
