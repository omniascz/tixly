/**
 * GET /api/public/tickets/[token]/totp
 *
 * Veřejný endpoint pro SMS magic link. Token (HMAC-signed) identifikuje ticket,
 * stejné chování jako /api/buyer/tickets/[id]/totp ale BEZ x-user-id auth.
 *
 * Bezpečnost: HMAC token = "ticket:<hex>" podpisem. Pouze majitel SMS / link
 * může token znát; třetí strana ho nemůže uhodnout (HMAC-SHA256).
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { decryptSecret } from '@/lib/crypto';
import { generateTotpCode } from '@/lib/totp/verify';
import { verifyTicketMagicToken } from '@/lib/tickets/magic-token';

const STEP_SECONDS = 30;

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface TicketRow {
  id: string;
  status: string;
  totp_secret_encrypted: Buffer;
  event_title: string;
  ticket_type_name: string;
  holder_name: string | null;
  event_date_start: string | null;
  venue_name: string | null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } },
): Promise<Response> {
  const ticketId = verifyTicketMagicToken(params.token);
  if (!ticketId) {
    return NextResponse.json({ error: 'INVALID_TOKEN' }, { status: 403 });
  }

  const r = await db().query<TicketRow>(
    `SELECT t.id, t.status, t.totp_secret_encrypted, t.holder_name,
            tt.name AS ticket_type_name,
            e.title AS event_title, e.date_start AS event_date_start,
            v.name AS venue_name
     FROM tickets.tickets t
     JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
     JOIN orders.orders o ON o.id = t.order_id
     JOIN catalog.events e ON e.id = o.event_id
     LEFT JOIN catalog.venues v ON v.id = e.venue_id
     WHERE t.id = $1`,
    [ticketId],
  );

  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  const t = r.rows[0]!;

  if (t.status === 'revoked') {
    return NextResponse.json(
      { error: 'REVOKED', ticketId: t.id, eventTitle: t.event_title },
      { status: 410 },
    );
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
    eventTitle: t.event_title,
    ticketTypeName: t.ticket_type_name,
    holderName: t.holder_name,
    eventDate: t.event_date_start,
    venueName: t.venue_name,
  });
}
