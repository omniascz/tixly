/**
 * PATCH  /api/admin/events/[id]/ticket-types/[ttId] — edit ticket type + capacity adjustment
 * DELETE /api/admin/events/[id]/ticket-types/[ttId] — delete (only if 0 tickets issued)
 *
 * Capacity adjustment logic:
 *   new total_qty = totalQty (input)
 *   new remaining_qty = remainingQty + (totalQty - old total_qty)
 *   Constraint: remaining_qty cannot go below 0
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  priceHalire: z.number().int().min(0).optional(),
  totalQty: z.number().int().min(1).max(1_000_000).optional(),
  maxPerUser: z.number().int().min(1).max(100).nullable().optional(),
  zone: z.string().max(200).nullable().optional(),
  isSeated: z.boolean().optional(),
  streamAccess: z.enum(['live', 'live_and_replay', 'none']).optional(),
});

async function ensureOwnership(eventId: string, ttId: string, promoterId: string) {
  const r = await db().query(
    `SELECT tt.id, tt.total_qty, tt.remaining_qty
     FROM catalog.ticket_types tt
     JOIN catalog.events e ON e.id = tt.event_id
     WHERE tt.id = $1 AND tt.event_id = $2 AND e.promoter_id = $3
     LIMIT 1`,
    [ttId, eventId, promoterId],
  );
  return r.rows[0] as { id: string; total_qty: number; remaining_qty: number } | undefined;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; ttId: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (
      !/^[0-9a-f-]{36}$/i.test(params.id) ||
      !/^[0-9a-f-]{36}$/i.test(params.ttId)
    ) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 422 },
      );
    }
    const input = parsed.data;

    const tt = await ensureOwnership(params.id, params.ttId, promoter.promoterId);
    if (!tt) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Capacity adjustment: delta applied to remaining_qty
    let newRemainingQty = tt.remaining_qty;
    if (input.totalQty !== undefined) {
      const delta = input.totalQty - tt.total_qty;
      newRemainingQty = tt.remaining_qty + delta;
      if (newRemainingQty < 0) {
        return NextResponse.json(
          {
            error: 'CAPACITY_BELOW_SOLD',
            message: `Nelze snížit kapacitu pod počet prodaných vstupenek. Prodáno: ${tt.total_qty - tt.remaining_qty}, minimum: ${tt.total_qty - tt.remaining_qty}.`,
          },
          { status: 422 },
        );
      }
    }

    await db().query(
      `UPDATE catalog.ticket_types
       SET name = COALESCE($1, name),
           description = CASE WHEN $2::text IS NOT NULL THEN $2::text ELSE description END,
           base_price = COALESCE($3, base_price),
           total_qty = COALESCE($4, total_qty),
           remaining_qty = CASE WHEN $4 IS NOT NULL THEN $5 ELSE remaining_qty END,
           max_per_user = COALESCE($6, max_per_user),
           zone = COALESCE($7, zone),
           is_seated = COALESCE($8, is_seated),
           stream_access = COALESCE($10, stream_access),
           updated_at = NOW()
       WHERE id = $9`,
      [
        input.name ?? null,
        input.description !== undefined ? (input.description ?? null) : null,
        input.priceHalire ?? null,
        input.totalQty ?? null,
        newRemainingQty,
        input.maxPerUser !== undefined ? (input.maxPerUser ?? null) : null,
        input.zone !== undefined ? (input.zone ?? null) : null,
        input.isSeated !== undefined ? input.isSeated : null,
        params.ttId,
        input.streamAccess ?? null,
      ],
    );

    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; ttId: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (
      !/^[0-9a-f-]{36}$/i.test(params.id) ||
      !/^[0-9a-f-]{36}$/i.test(params.ttId)
    ) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
    }

    const tt = await ensureOwnership(params.id, params.ttId, promoter.promoterId);
    if (!tt) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Check if any tickets have been issued
    const issued = await db().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM tickets.tickets
       WHERE ticket_type_id = $1 AND status != 'cancelled'`,
      [params.ttId],
    );
    if (parseInt(issued.rows[0]?.count ?? '0', 10) > 0) {
      return NextResponse.json(
        {
          error: 'HAS_ISSUED_TICKETS',
          message: 'Nelze smazat typ vstupenky, ke kterému existují vydané vstupenky.',
        },
        { status: 409 },
      );
    }

    await db().query(`DELETE FROM catalog.ticket_types WHERE id = $1`, [params.ttId]);

    return NextResponse.json({ ok: true });
  });
}
