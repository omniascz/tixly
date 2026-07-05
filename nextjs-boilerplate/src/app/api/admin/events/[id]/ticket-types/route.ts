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
  streamAccess: z.enum(['live', 'live_and_replay', 'none']).optional(),
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
      stream_access: string;
      sold_qty: string;
      issued_qty: string;
      presale_code_required: boolean;
      presale_starts_at: string | null;
      presale_ends_at: string | null;
      presale_code: string | null;
      max_per_buyer: number | null;
    }>(
      `SELECT
         tt.id,
         tt.name,
         NULL::text AS description,
         tt.kind,
         tt.base_price,
         tt.total_qty,
         tt.remaining_qty,
         tt.max_per_user,
         tt.zone,
         COALESCE(tt.is_seated, false) AS is_seated,
         tt.stream_access,
         (tt.total_qty - tt.remaining_qty)::text AS sold_qty,
         COUNT(t.id)::text AS issued_qty,
         COALESCE(tt.presale_code_required, false) AS presale_code_required,
         tt.presale_starts_at::text AS presale_starts_at,
         tt.presale_ends_at::text AS presale_ends_at,
         tt.presale_code,
         tt.max_per_buyer
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
        streamAccess: r.stream_access,
        presaleCodeRequired: r.presale_code_required,
        presaleStartsAt: r.presale_starts_at,
        presaleEndsAt: r.presale_ends_at,
        presaleCode: r.presale_code,
        maxPerBuyer: r.max_per_buyer,
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

    const ownership = await db().query<{ currency: string; status: string }>(
      `SELECT currency, status FROM catalog.events WHERE id = $1 AND promoter_id = $2 LIMIT 1`,
      [params.id, promoter.promoterId],
    );
    if (ownership.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const evStatus = ownership.rows[0].status;
    if (evStatus === 'cancelled' || evStatus === 'ended') {
      return NextResponse.json(
        {
          error: 'EVENT_TERMINAL_STATUS',
          message: `Nelze přidat typ vstupenky — akce je ve stavu "${evStatus}".`,
        },
        { status: 409 },
      );
    }

    // remaining_qty = totalQty je záměrné: nový TT nemá žádné prodané vstupenky,
    // takže celá kapacita je okamžitě dostupná i za aktivního prodeje.
    const r = await db().query<{ id: string }>(
      `INSERT INTO catalog.ticket_types
         (event_id, name, kind, base_price, total_qty, remaining_qty,
          max_per_user, zone, is_seated, stream_access, created_at)
       VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, NOW())
       RETURNING id`,
      [
        params.id,
        input.name,
        input.kind ?? 'standing',
        input.priceHalire,
        input.totalQty,
        input.maxPerUser ?? null,
        input.zone ?? null,
        input.isSeated ?? false,
        input.streamAccess ?? 'live',
      ],
    );

    return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
  });
}
