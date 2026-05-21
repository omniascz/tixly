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

  const r = await db().query<TicketRow & {
    event_date_start: string;
    qr_reveal_minutes_before: number;
    bound_phone_e164: string | null;
    require_phone_binding: boolean;
    user_phone: string | null;
    require_tan_validation: boolean;
    tan_validated_at: string | null;
  }>(
    `SELECT t.id, t.owner_id, t.status, t.totp_secret_encrypted,
            e.date_start::text AS event_date_start,
            COALESCE(e.qr_reveal_minutes_before, 0) AS qr_reveal_minutes_before,
            t.bound_phone_e164,
            COALESCE(e.require_phone_binding, false) AS require_phone_binding,
            u.phone AS user_phone,
            COALESCE(e.require_tan_validation, false) AS require_tan_validation,
            o.tan_validated_at::text
       FROM tickets.tickets t
       JOIN orders.orders o ON o.id = t.order_id
       JOIN catalog.events e ON e.id = o.event_id
       JOIN identity.users u ON u.id = t.owner_id
      WHERE t.id = $1`,
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

  // Eventim Pass-style: hidden until event
  const eventStartMs = new Date(t.event_date_start).getTime();
  const revealAtMs = eventStartMs - t.qr_reveal_minutes_before * 60 * 1000;
  const isRevealed = Date.now() >= revealAtMs;

  // TAN validation requirement
  if (t.require_tan_validation && !t.tan_validated_at) {
    return NextResponse.json({
      error: 'TAN_VALIDATION_REQUIRED',
      message: 'Pro tento event musíš nejdřív ověřit SMS kód v objednávce.',
    }, { status: 403 });
  }

  // Phone-binding enforcement
  if (t.require_phone_binding) {
    if (!t.bound_phone_e164) {
      return NextResponse.json({
        error: 'PHONE_BINDING_REQUIRED',
        message: 'Lístek se musí navázat na telefonní číslo.',
      }, { status: 403 });
    }
    if (t.bound_phone_e164 !== t.user_phone) {
      return NextResponse.json({
        error: 'PHONE_MISMATCH',
        message: 'Tvé aktuální číslo neodpovídá číslu při nákupu. Změnu lze požádat přes podporu.',
      }, { status: 403 });
    }
  }

  // If not yet revealed: vrátí pouze metadata, ne QR kód
  if (!isRevealed) {
    return NextResponse.json({
      ticketId: t.id,
      revealed: false,
      revealsAt: new Date(revealAtMs).toISOString(),
      minutesUntilReveal: Math.ceil((revealAtMs - Date.now()) / 60_000),
      message: `QR kód se zobrazí ${t.qr_reveal_minutes_before} minut před akcí.`,
      status: t.status,
    });
  }

  const secretB64 = decryptSecret(t.totp_secret_encrypted.toString('base64'));
  const secretRaw = Buffer.from(secretB64, 'base64');

  const nowMs = Date.now();
  const code = generateTotpCode(secretRaw, new Date(nowMs));
  const expiresInSec = STEP_SECONDS - Math.floor((nowMs / 1000) % STEP_SECONDS);

  return NextResponse.json({
    ticketId: t.id,
    revealed: true,
    code,
    expiresInSec,
    step: STEP_SECONDS,
    payload: `tixly:${t.id}:${code}`,
    status: t.status,
  });
}
