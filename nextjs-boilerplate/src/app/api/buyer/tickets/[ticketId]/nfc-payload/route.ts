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

  const r = await db().query<{ status: string }>(
    `SELECT status FROM tickets.tickets
      WHERE id = $1 AND owner_id = $2`,
    [params.ticketId, userId],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  if (r.rows[0].status !== 'valid') {
    return NextResponse.json({ error: 'TICKET_NOT_VALID', status: r.rows[0].status }, { status: 409 });
  }

  const { token, jti, exp } = signNfcPayload(params.ticketId);

  return NextResponse.json({
    token,
    jti,
    expiresAt: new Date(exp * 1000).toISOString(),
    ttlSeconds: exp - Math.floor(Date.now() / 1000),
  });
}
