/**
 * GET/POST/DELETE /api/admin/events/[id]/group-discounts
 *
 * Quantity tier slevy per ticket_type. Eventbrite Group tickets parita.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const postSchema = z.object({
  ticketTypeId: z.string().uuid(),
  minQuantity: z.number().int().min(2).max(1000),
  label: z.string().min(2).max(100),
  discountPct: z.number().min(0).max(95).optional(),
  discountFlatHalire: z.number().int().min(0).optional(),
}).refine((d) => d.discountPct !== undefined || d.discountFlatHalire !== undefined, {
  message: 'discountPct nebo discountFlatHalire musí být zadán',
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const { id: eventId } = await params;

  const r = await db().query(
    `SELECT gdt.id, gdt.ticket_type_id, tt.name AS ticket_type_name,
            gdt.min_quantity, gdt.label, gdt.discount_pct, gdt.discount_flat_halire
       FROM catalog.group_discount_tiers gdt
       JOIN catalog.ticket_types tt ON tt.id = gdt.ticket_type_id
       JOIN catalog.events e ON e.id = tt.event_id
      WHERE e.id = $1 AND e.promoter_id = $2
   ORDER BY tt.name, gdt.min_quantity`,
    [eventId, promoter.promoterId],
  );

  return NextResponse.json({ tiers: r.rows });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.role === 'staff') {
    return NextResponse.json({ error: 'ADMIN_OR_OWNER_ONLY' }, { status: 403 });
  }
  const { id: eventId } = await params;

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
  }

  // Ownership
  const own = await db().query(
    `SELECT 1 FROM catalog.ticket_types tt
       JOIN catalog.events e ON e.id = tt.event_id
      WHERE tt.id = $1 AND e.id = $2 AND e.promoter_id = $3`,
    [parsed.data.ticketTypeId, eventId, promoter.promoterId],
  );
  if (own.rows.length === 0) return NextResponse.json({ error: 'NOT_OWNER' }, { status: 403 });

  try {
    const r = await db().query<{ id: string }>(
      `INSERT INTO catalog.group_discount_tiers
         (ticket_type_id, min_quantity, label, discount_pct, discount_flat_halire)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        parsed.data.ticketTypeId, parsed.data.minQuantity, parsed.data.label,
        parsed.data.discountPct ?? null, parsed.data.discountFlatHalire ?? null,
      ],
    );
    return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'DUPLICATE_TIER' }, { status: 409 });
    }
    return NextResponse.json({ error: 'DB_ERROR' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.role === 'staff') {
    return NextResponse.json({ error: 'ADMIN_OR_OWNER_ONLY' }, { status: 403 });
  }
  const { id: eventId } = await params;
  const tierId = new URL(req.url).searchParams.get('tierId');
  if (!tierId) return NextResponse.json({ error: 'TIER_ID_REQUIRED' }, { status: 422 });

  const r = await db().query(
    `DELETE FROM catalog.group_discount_tiers gdt
      USING catalog.ticket_types tt, catalog.events e
      WHERE gdt.id = $1
        AND gdt.ticket_type_id = tt.id
        AND tt.event_id = e.id
        AND e.id = $2 AND e.promoter_id = $3
    RETURNING gdt.id`,
    [tierId, eventId, promoter.promoterId],
  );
  if (r.rows.length === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
