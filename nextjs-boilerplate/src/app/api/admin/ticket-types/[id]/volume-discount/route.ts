/**
 * GET    /api/admin/ticket-types/[id]/volume-discount  — list pravidel
 * PUT    /api/admin/ticket-types/[id]/volume-discount  — replace all tiers atomicky
 * DELETE /api/admin/ticket-types/[id]/volume-discount  — smazat všechna pravidla
 *
 * Body PUT: { tiers: [{ minQty: 5, discountPct: 10 }, { minQty: 10, discountPct: 15 }] }
 * Validace: tier minQty >= 2, discountPct 1–90, jedinečnost minQty per ticket type.
 *
 * Ownership: promotér musí vlastnit event ticket_type (přes JOIN catalog.events.promoter_id).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';


const tierSchema = z.object({
  minQty: z.number().int().min(2).max(1000),
  discountPct: z.number().int().min(0).max(90),
  freeQty: z.number().int().min(0).max(20).optional().default(0),
});
const putSchema = z.object({
  tiers: z.array(tierSchema).max(10),
});

async function authorizeTicketTypeOwnership(
  ticketTypeId: string,
  promoterId: string,
): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(ticketTypeId)) return false;
  const r = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM catalog.ticket_types tt
     JOIN catalog.events e ON e.id = tt.event_id
     WHERE tt.id = $1 AND e.promoter_id = $2`,
    [ticketTypeId, promoterId],
  );
  return Number(r.rows[0]?.count ?? 0) > 0;
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
  const ok = await authorizeTicketTypeOwnership(params.id, promoter.promoterId);
  if (!ok) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const r = await db().query<{
    id: string;
    min_qty: number;
    discount_pct: number;
    free_qty: number;
    active: boolean;
  }>(
    `SELECT id, min_qty, discount_pct, free_qty, active
     FROM catalog.volume_discount_rules
     WHERE ticket_type_id = $1
     ORDER BY min_qty ASC`,
    [params.id],
  );
  return NextResponse.json({
    ticketTypeId: params.id,
    tiers: r.rows.map((row) => ({
      id: row.id,
      minQty: row.min_qty,
      discountPct: row.discount_pct,
      freeQty: row.free_qty,
      active: row.active,
    })),
  });

  });
}

export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
  const ok = await authorizeTicketTypeOwnership(params.id, promoter.promoterId);
  if (!ok) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BAD_INPUT', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  // Validate uniqueness of minQty in payload + BOGO/discount mutual exclusivity
  const seen = new Set<number>();
  for (const t of parsed.data.tiers) {
    if (seen.has(t.minQty)) {
      return NextResponse.json(
        { error: 'DUPLICATE_MIN_QTY', message: `Tier minQty=${t.minQty} je duplicitní.` },
        { status: 422 },
      );
    }
    seen.add(t.minQty);
    if ((t.freeQty ?? 0) > 0 && t.discountPct > 0) {
      return NextResponse.json(
        { error: 'INVALID_TIER', message: 'Kombinace free_qty a discount_pct není povolena' },
        { status: 422 },
      );
    }
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM catalog.volume_discount_rules WHERE ticket_type_id = $1`,
      [params.id],
    );
    for (const t of parsed.data.tiers) {
      await client.query(
        `INSERT INTO catalog.volume_discount_rules (ticket_type_id, min_qty, discount_pct, free_qty)
         VALUES ($1, $2, $3, $4)`,
        [params.id, t.minQty, t.discountPct, t.freeQty ?? 0],
      );
    }
    await client.query(
      `INSERT INTO audit.audit_log
         (schema_name, table_name, record_id, action, actor_id, actor_type, new_values)
       VALUES ('catalog', 'volume_discount_rules', $1, 'UPDATE', $2, 'user', $3::jsonb)`,
      [
        params.id,
        promoter.userId,
        JSON.stringify({ kind: 'volume_discount_replace', tiers: parsed.data.tiers }),
      ],
    );
    await client.query('COMMIT');
    return NextResponse.json({ ok: true, ticketTypeId: params.id, tiers: parsed.data.tiers });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PUT volume-discount]', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
  const ok = await authorizeTicketTypeOwnership(params.id, promoter.promoterId);
  if (!ok) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  await db().query(
    `DELETE FROM catalog.volume_discount_rules WHERE ticket_type_id = $1`,
    [params.id],
  );
  return NextResponse.json({ ok: true });

  });
}
