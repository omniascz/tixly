/**
 * POST /api/hardware/scan
 *
 * REST endpoint pro průmyslové skenovací zařízení (Zebra handhelds, NFC čtečky,
 * turnikety) — autentizace přes device API key (nevyžaduje JWT ani cookies).
 *
 * Auth: Authorization: Bearer tixly_dev_<hex>
 *   nebo: X-Device-Key: tixly_dev_<hex>
 *
 * Body:
 *   { barcode: "tixly:<uuid>:<6digitCode>", gateId?: "<uuid>", deviceLabel?: "<string>" }
 *   nebo: { ticketId: "<uuid>", totpCode: "<6digits>", gateId?: "<uuid>" }
 *
 * Response:
 *   { result: "admitted" | "already_used" | "denied", color: "green" | "amber" | "red",
 *     message: string, ticket?: { ... } }
 *
 * Slouží jako webhook pro hardware partnerů — device posílá sken, Tixly odpoví
 * do 300ms s barevným výsledkem (green/amber/red) kompatibilním s LED displejemi.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { z } from 'zod';
import { decryptSecret } from '@/lib/crypto';
import { verifyTotpCode } from '@/lib/totp/verify';

const schema = z.union([
  z.object({
    barcode: z.string().min(10).max(200),
    gateId: z.string().uuid().optional(),
    deviceLabel: z.string().max(100).optional(),
  }),
  z.object({
    ticketId: z.string().uuid(),
    totpCode: z.string().regex(/^\d{6}$/).optional(),
    gateId: z.string().uuid().optional(),
    deviceLabel: z.string().max(100).optional(),
  }),
]);

interface DeviceRow {
  id: string;
  promoter_id: string;
  active: boolean;
}

interface TicketRow {
  id: string;
  status: string;
  used_at: string | null;
  totp_secret_encrypted: Buffer;
  event_promoter_id: string;
  event_title: string;
  ticket_type_name: string;
  buyer_email: string;
  buyer_name: string | null;
}

export async function POST(req: NextRequest): Promise<Response> {
  const deviceKey =
    req.headers.get('x-device-key') ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

  if (!deviceKey || !deviceKey.startsWith('tixly_dev_')) {
    return NextResponse.json(
      { result: 'denied', color: 'red', message: 'Chybí nebo neplatný device API klíč.' },
      { status: 401 },
    );
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { result: 'denied', color: 'red', message: 'Neplatný formát požadavku.', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  return runWithServiceContext(async () => {
    // Ověřit device API klíč
    const devRes = await db().query<DeviceRow>(
      `SELECT id, promoter_id, active FROM catalog.scanner_devices WHERE api_key = $1 LIMIT 1`,
      [deviceKey],
    );
    if (devRes.rows.length === 0) {
      return NextResponse.json(
        { result: 'denied', color: 'red', message: 'Neznámý device klíč.' },
        { status: 401 },
      );
    }
    const device = devRes.rows[0];
    if (!device.active) {
      return NextResponse.json(
        { result: 'denied', color: 'red', message: 'Zařízení je deaktivováno.' },
        { status: 403 },
      );
    }

    // Update last_seen_at asynchronně (neblokuje odpověď)
    void db().query(
      `UPDATE catalog.scanner_devices SET last_seen_at = NOW() WHERE id = $1`,
      [device.id],
    ).catch(() => {});

    // Parsovat barcode nebo ticketId
    let ticketId: string;
    let totpCode: string | undefined;

    const inp = parsed.data;
    if ('barcode' in inp) {
      // Formát: "tixly:<uuid>:<6digit>"
      const match = /^tixly:([0-9a-f-]{36}):(\d{6})$/i.exec(inp.barcode);
      if (!match) {
        return NextResponse.json(
          { result: 'denied', color: 'red', message: 'Neplatný formát čárového kódu.' },
          { status: 422 },
        );
      }
      ticketId = match[1];
      totpCode = match[2];
    } else {
      ticketId = inp.ticketId;
      totpCode = inp.totpCode;
    }

    const client = await db().connect();
    try {
      await client.query('BEGIN');
      const r = await client.query<TicketRow>(
        `SELECT t.id, t.status, t.used_at::text, t.totp_secret_encrypted,
                e.promoter_id AS event_promoter_id,
                e.title AS event_title,
                tt.name AS ticket_type_name,
                u.email AS buyer_email, u.name AS buyer_name
         FROM tickets.tickets t
         JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
         JOIN orders.orders o ON o.id = t.order_id
         JOIN catalog.events e ON e.id = o.event_id
         JOIN identity.users u ON u.id = t.owner_id
         WHERE t.id = $1
         FOR UPDATE OF t`,
        [ticketId],
      );

      if (r.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ result: 'not_found', color: 'red', message: 'Lístek nenalezen.' }, { status: 200 });
      }
      const t = r.rows[0];

      if (t.event_promoter_id !== device.promoter_id) {
        await client.query('ROLLBACK');
        return NextResponse.json({ result: 'denied', color: 'red', message: 'Lístek patří jinému promotérovi.' }, { status: 200 });
      }

      if (t.status === 'revoked') {
        await client.query('ROLLBACK');
        return NextResponse.json({ result: 'denied', color: 'red', message: 'Lístek byl stornován.' }, { status: 200 });
      }

      if (t.status === 'used') {
        await client.query('ROLLBACK');
        return NextResponse.json({
          result: 'already_used', color: 'amber',
          message: `Lístek byl již použit (${t.used_at ? new Date(t.used_at).toLocaleString('cs-CZ') : 'neznámý čas'}).`,
          ticket: { ticketId: t.id, eventTitle: t.event_title, ticketTypeName: t.ticket_type_name, holderEmail: t.buyer_email, holderName: t.buyer_name },
        }, { status: 200 });
      }

      // TOTP ověření (pokud je kód přítomen)
      if (totpCode && t.totp_secret_encrypted) {
        const secretB64 = decryptSecret(t.totp_secret_encrypted.toString('base64'));
        const secretRaw = Buffer.from(secretB64, 'base64');
        const valid = verifyTotpCode(totpCode, secretRaw, { atDate: new Date() });
        if (!valid) {
          await client.query('ROLLBACK');
          return NextResponse.json({ result: 'denied', color: 'red', message: 'TOTP kód neplatný nebo expiroval.' }, { status: 200 });
        }
      }

      // Admit
      const admittedAt = new Date().toISOString();
      await client.query(
        `UPDATE tickets.tickets SET status = 'used', used_at = NOW() WHERE id = $1`,
        [t.id],
      );
      await client.query('COMMIT');

      return NextResponse.json({
        result: 'admitted',
        color: 'green',
        message: 'Vstup povolen.',
        admittedAt,
        ticket: {
          ticketId: t.id,
          eventTitle: t.event_title,
          ticketTypeName: t.ticket_type_name,
          holderEmail: t.buyer_email,
          holderName: t.buyer_name,
        },
      }, { status: 200 });

    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[hardware/scan]', err);
      return NextResponse.json({ result: 'error', color: 'red', message: 'Interní chyba serveru.' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
