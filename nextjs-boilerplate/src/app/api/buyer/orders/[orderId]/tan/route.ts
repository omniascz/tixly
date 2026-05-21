/**
 * POST /api/buyer/orders/[orderId]/tan
 *   → Vydá SMS TAN code pro validaci objednávky.
 *     Vyžaduje, že order patří k hot_event_mode=true eventu s require_tan_validation.
 *
 * POST /api/buyer/orders/[orderId]/tan/verify  (separate file)
 *   → Verifikuje code.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { issueTan } from '@/lib/sms/tan';
import { getEventHotConfig } from '@/lib/hot-events/enforcement';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { orderId: string } },
): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const r = await db().query<{
    id: string;
    user_id: string;
    event_id: string;
    phone_e164: string | null;
  }>(
    `SELECT o.id, o.user_id, o.event_id, u.phone AS phone_e164
       FROM orders.orders o
       JOIN identity.users u ON u.id = o.user_id
      WHERE o.id = $1`,
    [params.orderId],
  );

  if (r.rows.length === 0 || r.rows[0].user_id !== userId) {
    return NextResponse.json({ error: 'NOT_FOUND_OR_NOT_OWNER' }, { status: 404 });
  }
  const order = r.rows[0];

  if (!order.phone_e164) {
    return NextResponse.json({
      error: 'NO_PHONE',
      message: 'Pro hot event musíš v profilu mít ověřené telefonní číslo (E.164 formát).',
    }, { status: 422 });
  }

  const config = await getEventHotConfig(order.event_id);
  if (!config?.requireTanValidation) {
    return NextResponse.json({
      error: 'TAN_NOT_REQUIRED',
      message: 'Tento event nevyžaduje TAN validaci.',
    }, { status: 400 });
  }

  const result = await issueTan({
    userId,
    phoneE164: order.phone_e164,
    purpose: 'order_validation',
    relatedId: order.id,
  });

  return NextResponse.json({
    tanId: result.tanId,
    expiresAt: result.expiresAt,
    sentTo: maskPhone(order.phone_e164),
    devCode: result.devCode,
  }, { status: 201 });
}

function maskPhone(phone: string): string {
  if (phone.length < 6) return phone;
  return phone.slice(0, 3) + '****' + phone.slice(-3);
}
