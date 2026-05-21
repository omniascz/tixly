/**
 * GET /api/buyer/tickets/[ticketId]/nfc-payload
 *
 * Vrátí krátkodobý NFC payload (signed HMAC, TTL 10s).
 * Mobile aplikace ho zapíše do NFC tag emulation a uživatel přiloží
 * telefon ke scanneru. Replay protection přes UNIQUE jti v nfc_taps.
 *
 * Vrací: { token, expiresAt, jti }
 *
 * Frontend pollne každých ~7s pro fresh payload.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { signNfcPayload } from '@/lib/safetix/nfc';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { ticketId: string } },
): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const r = await db().query<{
    status: string;
    delivery_method: string | null;
    will_call_picked_up_at: string | null;
  }>(
    `SELECT t.status, o.delivery_method, o.will_call_picked_up_at::text
       FROM tickets.tickets t
       JOIN orders.orders o ON o.id = t.order_id
      WHERE t.id = $1 AND t.owner_id = $2`,
    [params.ticketId, userId],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  if (r.rows[0].status !== 'valid') {
    return NextResponse.json({ error: 'TICKET_NOT_VALID', status: r.rows[0].status }, { status: 409 });
  }
  // Will Call lístky se vydávají fyzicky na pokladně — NFC payload nemá smysl
  // dokud buyer nevyzvedne ticket osobně. Po pickup je delivery_method efektivně 'mobile'.
  if (r.rows[0].delivery_method === 'will_call' && !r.rows[0].will_call_picked_up_at) {
    return NextResponse.json({
      error: 'WILL_CALL_NOT_PICKED_UP',
      message: 'Lístek je k vyzvednutí na pokladně. NFC bude aktivní až po pickup.',
    }, { status: 409 });
  }

  const { token, jti, exp } = signNfcPayload(params.ticketId);

  return NextResponse.json({
    token,
    jti,
    expiresAt: new Date(exp * 1000).toISOString(),
    ttlSeconds: exp - Math.floor(Date.now() / 1000),
  });
}
