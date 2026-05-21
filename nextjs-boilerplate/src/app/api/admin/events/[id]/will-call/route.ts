/**
 * GET/PATCH /api/admin/events/[id]/will-call
 *
 * Will Call mode config (pickup at box office).
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
  deliveryMethods: z.array(z.enum(['mobile', 'pdf', 'will_call', 'wallet'])).min(1).optional(),
  willCallPickupLocation: z.string().max(500).optional(),
  willCallPickupHours: z.string().max(200).optional(),
  willCallIdRequired: z.boolean().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const { id: eventId } = await params;

  const r = await db().query<{
    delivery_methods: string[];
    will_call_pickup_location: string | null;
    will_call_pickup_hours: string | null;
    will_call_id_required: boolean;
    will_call_picked_up_count: string;
    will_call_pending_count: string;
  }>(
    `SELECT e.delivery_methods, e.will_call_pickup_location,
            e.will_call_pickup_hours, e.will_call_id_required,
            (SELECT COUNT(*)::text FROM orders.orders
              WHERE event_id = e.id AND delivery_method = 'will_call'
                AND will_call_picked_up_at IS NOT NULL) AS will_call_picked_up_count,
            (SELECT COUNT(*)::text FROM orders.orders
              WHERE event_id = e.id AND delivery_method = 'will_call'
                AND will_call_picked_up_at IS NULL
                AND status = 'paid') AS will_call_pending_count
       FROM catalog.events e
      WHERE e.id = $1 AND e.promoter_id = $2`,
    [eventId, promoter.promoterId],
  );

  if (r.rows.length === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({
    config: r.rows[0],
    stats: {
      pickedUp: Number(r.rows[0].will_call_picked_up_count),
      pending: Number(r.rows[0].will_call_pending_count),
    },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.role === 'staff') {
    return NextResponse.json({ error: 'ADMIN_OR_OWNER_ONLY' }, { status: 403 });
  }
  const { id: eventId } = await params;

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });

  const updates: string[] = [];
  const args: unknown[] = [eventId, promoter.promoterId];
  function add(col: string, val: unknown) {
    args.push(val);
    updates.push(`${col} = $${args.length}`);
  }
  if (parsed.data.deliveryMethods) add('delivery_methods', parsed.data.deliveryMethods);
  if (parsed.data.willCallPickupLocation !== undefined) add('will_call_pickup_location', parsed.data.willCallPickupLocation);
  if (parsed.data.willCallPickupHours !== undefined) add('will_call_pickup_hours', parsed.data.willCallPickupHours);
  if (parsed.data.willCallIdRequired !== undefined) add('will_call_id_required', parsed.data.willCallIdRequired);

  if (updates.length === 0) return NextResponse.json({ ok: true, noop: true });

  const r = await db().query(
    `UPDATE catalog.events SET ${updates.join(', ')}, updated_at = now()
      WHERE id = $1 AND promoter_id = $2 RETURNING id`,
    args,
  );
  if (r.rows.length === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
