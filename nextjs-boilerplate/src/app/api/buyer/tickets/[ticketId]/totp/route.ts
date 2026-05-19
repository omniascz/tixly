/**
 * GET /api/buyer/tickets/[ticketId]/totp
 *
 * Vrací aktuální 6-digit TOTP kód pro lístek + zbývající sekundy do dalšího okna.
 * Owner-only (ticket.owner_id == x-user-id z middleware).
 *
 * Frontend pollne tento endpoint na hraně každého 30s okna a renderuje
 * QR `tixly:<ticketId>:<code>`. Scanner kód ověří přes `verifyTotpCode`
 * (RFC 6238, ±1 window tolerance).
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { decryptSecret } from '@/lib/crypto';
import { generateTotpCode } from '@/lib/totp/verify';

const STEP_SECONDS = 30;

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface TicketRow {
  id: string;
  owner_id: string;
  status: string;
  totp_secret_encrypted: Buffer;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { ticketId: string } },
): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!/^[0-9a-f-]{36}$/i.test(params.ticketId)) {
    return NextResponse.json({ error: 'Invalid ticket id' }, { status: 422 });
  }

  const r = await db().query<TicketRow>(
    `SELECT id, owner_id, status, totp_secret_encrypted
     FROM tickets.tickets
     WHERE id = $1`,
    [params.ticketId],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const t = r.rows[0];
  if (t.owner_id !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (t.status === 'revoked') {
    return NextResponse.json({ error: 'Ticket revoked' }, { status: 410 });
  }

  const secretB64 = decryptSecret(t.totp_secret_encrypted.toString('base64'));
  const secretRaw = Buffer.from(secretB64, 'base64');

  const nowMs = Date.now();
  const code = generateTotpCode(secretRaw, new Date(nowMs));
  const expiresInSec = STEP_SECONDS - Math.floor((nowMs / 1000) % STEP_SECONDS);

  return NextResponse.json({
    ticketId: t.id,
    code,
    expiresInSec,
    step: STEP_SECONDS,
    payload: `tixly:${t.id}:${code}`,
    status: t.status,
  });
}
