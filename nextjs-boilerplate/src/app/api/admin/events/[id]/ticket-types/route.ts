/**
 * GET  /api/admin/events/[id]/ticket-types — list all ticket types with sold counts
 * POST /api/admin/events/[id]/ticket-types — add new ticket type to existing event
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  priceHalire: z.number().int().min(0),
  totalQty: z.number().int().min(1).max(1_000_000),
  maxPerUser: z.number().int().min(1).max(100).nullable().optional(),
  zone: z.string().max(200).nullable().optional(),
  isSeated: z.boolean().optional(),
  kind: z.enum(['standing', 'seated', 'flex', 'online', 'addon']).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
    }

    const ownership = await db().query(
      `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2 LIMIT 1`,
      [params.id, promoter.promoterId],
    );
    if (ownership.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const rows = await db().query<{
      id: string;
      name: string;
      description: string | null;
      kind: string;
      base_price: number;
      total_qty: number;
      remaining_qty: number;
      max_per_user: number | null;
      zone: string | null;
      is_seated: boolean;
      sold_qty: string;
      issued_qty: string;
    }>(
      `SELECT
         tt.id,
         tt.name,
         tt.description,
         tt.kind,
         tt.base_price,
         tt.total_qty,
         tt.remaining_qty,
         tt.max_per_user,
         tt.zone,
         COALESCE(tt.is_seated, false) AS is_seated,
         (tt.total_qty - tt.remaining_qty)::text AS sold_qty,
         COUNT(t.id)::text AS issued_qty
       FROM catalog.ticket_types tt
       LEFT JOIN tickets.tickets t ON t.ticket_type_id = tt.id AND t.status != 'cancelled'
       WHERE tt.event_id = $1
       GROUP BY tt.id
       ORDER BY tt.created_at`,
      [params.id],
    );

    return NextResponse.json({
      ticketTypes: rows.rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        kind: r.kind,
        basePrice: r.base_price,
        totalQty: r.total_qty,
        remainingQty: r.remaining_qty,
        soldQty: parseInt(r.sold_qty, 10),
        issuedQty: parseInt(r.issued_qty, 10),
        maxPerUser: r.max_per_user,
        zone: r.zone,
        isSeated: r.is_seated,
      })),
    });
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
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

    const ownership = await db().query(
      `SELECT currency FROM catalog.events WHERE id = $1 AND promoter_id = $2 LIMIT 1`,
      [params.id, promoter.promoterId],
    );
    if (ownership.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const r = await db().query<{ id: string }>(
      `INSERT INTO catalog.ticket_types
         (event_id, name, description, kind, base_price, total_qty, remaining_qty,
          max_per_user, zone, is_seated, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, NOW())
       RETURNING id`,
      [
        params.id,
        input.name,
        input.description ?? null,
        input.kind ?? 'standing',
        input.priceHalire,
        input.totalQty,
        input.maxPerUser ?? null,
        input.zone ?? null,
        input.isSeated ?? false,
      ],
    );

    return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
  });
}
