/**
 * POST /api/admin/scanner/reentry
 *
 * Re-entry-aware scanner pro festivaly / open-air akce.
 *
 * Body: { ticketId, totpCode?, mode: 'entry'|'exit', gateId? }
 *
 * State machine per ticket:
 *   - mode='entry':
 *     - scan_count = 0 → first entry: scan_count=1, currently_inside=TRUE
 *     - scan_count > 0 AND !currently_inside AND scan_count < reentry_max_count
 *       → re-entry: scan_count++, currently_inside=TRUE
 *     - already inside → 409 ALREADY_INSIDE
 *     - max scans exceeded → 409 REENTRY_LIMIT_EXCEEDED
 *   - mode='exit':
 *     - currently_inside → set FALSE, log exit
 *     - not inside → 409 NOT_INSIDE
 *
 * Vyžaduje events.reentry_allowed=TRUE — jinak 422.
 * status zůstává 'valid' (ne 'used') aby další scan fungoval.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';
import { decryptSecret } from '@/lib/crypto';
import { verifyTotpCode } from '@/lib/totp/verify';


const schema = z.object({
  ticketId: z.string().regex(/^[0-9a-f-]{36}$/i),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
  mode: z.enum(['entry', 'exit']),
  gateId: z.string().uuid().optional(),
});

interface TicketRow {
  id: string;
  status: string;
  scan_count: number;
  currently_inside: boolean;
  totp_secret_encrypted: Buffer;
  event_id: string;
  event_title: string;
  event_reentry_allowed: boolean;
  event_reentry_max: number;
  event_promoter_id: string;
  ticket_type_name: string;
  buyer_email: string;
  holder_name: string | null;
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BAD_INPUT', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    const r = await client.query<TicketRow>(
      `SELECT t.id, t.status, t.scan_count, t.currently_inside,
              t.totp_secret_encrypted, t.holder_name,
              e.id AS event_id, e.title AS event_title,
              COALESCE(e.reentry_allowed, FALSE) AS event_reentry_allowed,
              COALESCE(e.reentry_max_count, 3) AS event_reentry_max,
              e.promoter_id AS event_promoter_id,
              tt.name AS ticket_type_name,
              u.email AS buyer_email
       FROM tickets.tickets t
       JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
       JOIN orders.orders o ON o.id = t.order_id
       JOIN catalog.events e ON e.id = o.event_id
       JOIN identity.users u ON u.id = t.owner_id
       WHERE t.id = $1
       FOR UPDATE`,
      [parsed.data.ticketId],
    );

    if (r.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ result: 'not_found' }, { status: 404 });
    }
    const t = r.rows[0];

    if (t.event_promoter_id !== promoter.promoterId) {
      await client.query('ROLLBACK');
      return NextResponse.json({ result: 'wrong_promoter' }, { status: 403 });
    }

    if (!t.event_reentry_allowed) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        {
          result: 'reentry_disabled',
          message: 'Akce nepovoluje re-entry. Použij standardní /scanner/validate.',
        },
        { status: 422 },
      );
    }

    if (parsed.data.totpCode) {
      const secretB64 = decryptSecret(t.totp_secret_encrypted.toString('base64'));
      const secretRaw = Buffer.from(secretB64, 'base64');
      if (!verifyTotpCode(parsed.data.totpCode, secretRaw, { window: 1 })) {
        await client.query('ROLLBACK');
        return NextResponse.json({ result: 'totp_mismatch' }, { status: 401 });
      }
    }

    if (t.status === 'revoked') {
      await client.query('ROLLBACK');
      return NextResponse.json({ result: 'revoked' }, { status: 409 });
    }
    if (t.status !== 'valid') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { result: 'invalid_status', status: t.status },
        { status: 409 },
      );
    }

    const shortInfo = {
      ticketId: t.id,
      eventTitle: t.event_title,
      ticketTypeName: t.ticket_type_name,
      holderName: t.holder_name,
      holderEmail: t.buyer_email,
    };

    if (parsed.data.mode === 'entry') {
      if (t.currently_inside) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            result: 'already_inside',
            ticket: shortInfo,
            scanCount: t.scan_count,
            message: 'Návštěvník je už uvnitř — entry scan nelze opakovat.',
          },
          { status: 409 },
        );
      }
      if (t.scan_count >= t.event_reentry_max) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            result: 'reentry_limit_exceeded',
            ticket: shortInfo,
            scanCount: t.scan_count,
            max: t.event_reentry_max,
            message: `Maximum re-entries (${t.event_reentry_max}) překročeno.`,
          },
          { status: 409 },
        );
      }

      const newCount = t.scan_count + 1;
      await client.query(
        `UPDATE tickets.tickets
         SET scan_count = $2, currently_inside = TRUE, last_entry_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [t.id, newCount],
      );

      const scanType = t.scan_count === 0 ? 'entry' : 'reentry';
      await client.query(
        `INSERT INTO tickets.scan_events
           (ticket_id, event_id, scan_type, scanned_by_user_id, gate_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [t.id, t.event_id, scanType, promoter.userId, parsed.data.gateId ?? null],
      );

      await client.query('COMMIT');
      return NextResponse.json({
        result: 'admitted',
        kind: scanType,
        ticket: shortInfo,
        scanCount: newCount,
        remaining: t.event_reentry_max - newCount,
        admittedAt: new Date().toISOString(),
      });
    }

    // mode === 'exit'
    if (!t.currently_inside) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        {
          result: 'not_inside',
          ticket: shortInfo,
          message: 'Návštěvník není uvnitř — exit scan nelze provést.',
        },
        { status: 409 },
      );
    }

    await client.query(
      `UPDATE tickets.tickets
       SET currently_inside = FALSE, last_exit_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [t.id],
    );

    await client.query(
      `INSERT INTO tickets.scan_events
         (ticket_id, event_id, scan_type, scanned_by_user_id, gate_id)
       VALUES ($1, $2, 'exit', $3, $4)`,
      [t.id, t.event_id, promoter.userId, parsed.data.gateId ?? null],
    );

    await client.query('COMMIT');
    return NextResponse.json({
      result: 'exited',
      ticket: shortInfo,
      scanCount: t.scan_count,
      remaining: t.event_reentry_max - t.scan_count,
      exitedAt: new Date().toISOString(),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /api/admin/scanner/reentry]', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
