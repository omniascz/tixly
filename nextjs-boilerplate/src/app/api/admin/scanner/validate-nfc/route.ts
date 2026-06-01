/**
 * POST /api/admin/scanner/validate-nfc
 *
 * Body: { nfcToken }
 *
 * SafeTix-grade NFC tap-to-enter validation:
 *   1. Verify HMAC signature + TTL (10s window)
 *   2. Replay protection: tickets.nfc_taps má UNIQUE jti → re-použití = block
 *   3. Promotér ownership check
 *   4. Status check (valid → admitted; used → already_used)
 *   5. UPDATE status = used + log do nfc_taps
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';
import { verifyNfcPayload } from '@/lib/safetix/nfc';


const schema = z.object({
  nfcToken: z.string().min(20).max(2048),
  gateId: z.string().uuid().optional(),
  deviceId: z.string().max(100).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
  }

  const verification = verifyNfcPayload(parsed.data.nfcToken);
  if (!verification.ok || !verification.payload) {
    return NextResponse.json({
      result: verification.reason === 'expired' ? 'expired' : 'invalid_signature',
      message: verification.reason === 'expired'
        ? 'NFC payload vypršel. Klient musí znovu tapnout.'
        : 'NFC payload má neplatný podpis nebo formát.',
    }, { status: 401 });
  }

  const { ticketId, jti, iat, exp } = verification.payload;

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    // Replay protection: INSERT s UNIQUE jti — duplicate = replay attack
    try {
      await client.query(
        `INSERT INTO tickets.nfc_taps
           (ticket_id, payload_id, issued_at, expires_at, scanned_by_user_id, gate_id, device_id, result)
         VALUES ($1, $2::uuid, to_timestamp($3), to_timestamp($4), $5, $6, $7, 'admitted')`,
        [
          ticketId, jti, iat, exp,
          promoter.userId, parsed.data.gateId ?? null, parsed.data.deviceId ?? null,
        ],
      );
    } catch (e) {
      await client.query('ROLLBACK');
      if ((e as { code?: string }).code === '23505') {
        // unique violation = replay
        return NextResponse.json(
          { result: 'replay', message: 'NFC payload už byl použit.' },
          { status: 409 },
        );
      }
      throw e;
    }

    const t = await client.query<{
      id: string; status: string; used_at: string | null;
      event_promoter_id: string; event_title: string;
      ticket_type_name: string; buyer_email: string;
    }>(
      `SELECT t.id, t.status, t.used_at::text,
              e.promoter_id AS event_promoter_id, e.title AS event_title,
              tt.name AS ticket_type_name, u.email AS buyer_email
         FROM tickets.tickets t
         JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
         JOIN orders.orders o ON o.id = t.order_id
         JOIN catalog.events e ON e.id = o.event_id
         JOIN identity.users u ON u.id = t.owner_id
        WHERE t.id = $1
        FOR UPDATE`,
      [ticketId],
    );

    if (t.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ result: 'not_found' }, { status: 404 });
    }
    const ticket = t.rows[0];

    if (ticket.event_promoter_id !== promoter.promoterId) {
      await client.query('UPDATE tickets.nfc_taps SET result = \'wrong_promoter\' WHERE payload_id = $1::uuid', [jti]);
      await client.query('COMMIT');
      return NextResponse.json(
        { result: 'wrong_promoter', message: 'Lístek patří k jinému promotérovi.' },
        { status: 403 },
      );
    }
    if (ticket.status === 'used') {
      await client.query('ROLLBACK');
      return NextResponse.json({
        result: 'already_used',
        usedAt: ticket.used_at,
        ticket: { eventTitle: ticket.event_title, ticketTypeName: ticket.ticket_type_name, holderEmail: ticket.buyer_email },
      });
    }
    if (ticket.status !== 'valid') {
      await client.query('ROLLBACK');
      return NextResponse.json({ result: 'invalid_status', status: ticket.status }, { status: 409 });
    }

    await client.query(
      `UPDATE tickets.tickets
          SET status = 'used', used_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [ticketId],
    );

    await client.query('COMMIT');

    return NextResponse.json({
      result: 'admitted',
      kind: 'nfc',
      ticket: { eventTitle: ticket.event_title, ticketTypeName: ticket.ticket_type_name, holderEmail: ticket.buyer_email },
      admittedAt: new Date().toISOString(),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[validate-nfc]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
