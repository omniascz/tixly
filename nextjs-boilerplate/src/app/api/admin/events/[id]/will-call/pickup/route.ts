/**
 * POST /api/admin/events/[id]/will-call/pickup
 *
 * Box office personál označí, že buyer vyzvedl will_call tickety.
 * Body: { orderId, pickedUpById? }
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

const schema = z.object({
  orderId: z.string().uuid(),
  pickedUpById: z.string().uuid().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const { id: eventId } = await params;

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });

  const r = await db().query(
    `UPDATE orders.orders
        SET will_call_picked_up_at = now(),
            will_call_picked_up_by_user_id = $1,
            updated_at = now()
       FROM catalog.events e
      WHERE orders.id = $2
        AND orders.event_id = e.id
        AND e.id = $3
        AND e.promoter_id = $4
        AND orders.delivery_method = 'will_call'
        AND orders.status = 'paid'
        AND orders.will_call_picked_up_at IS NULL
    RETURNING orders.id`,
    [
      parsed.data.pickedUpById ?? promoter.userId,
      parsed.data.orderId, eventId, promoter.promoterId,
    ],
  );

  if (r.rows.length === 0) {
    return NextResponse.json({
      error: 'NOT_ELIGIBLE',
      message: 'Order nenalezen, není will_call, nebo už vyzvednut.',
    }, { status: 404 });
  }
  return NextResponse.json({ ok: true, pickedUpAt: new Date().toISOString() });
}
