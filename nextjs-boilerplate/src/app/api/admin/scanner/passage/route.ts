/**
 * POST /api/admin/scanner/passage
 *
 * Průchod branou bez přepínání směru.
 *
 * Obsluha jen pípne. Server pozná z evidence, jestli držitel jde dovnitř, nebo
 * ven, provede to a **vrátí směr**, aby ho aplikace mohla ukázat a odlišit
 * zvukem. Když se zobrazené nesejde se skutečností, obsluha vezme sken zpět
 * přes `/passage/undo` — nepípá znovu, protože druhé pípnutí by stav překlopilo
 * zpátky a zároveň naúčtovalo průchod, který se nestal.
 *
 * Proti staršímu `/scanner/reentry` (kde se `mode` posílal ručně):
 *   • směr se neposílá, odvodí se
 *   • dvojí načtení téhož kódu se pozná podle prodlevy a stav se nepřeklopí
 *   • brána může mít směr natvrdo
 *   • odpověď nese aktuální obsazenost
 *
 * Body: { ticketId | printToken, totpCode?, gateId? }
 *
 * Kolo 5: politika QR (rotující TOTP / tištěný TXP2) se vynucuje stejně jako ve validate —
 * dřív průchod pustil holé UUID i tam, kde akce vyžaduje rotující QR (lib/scanner/qr-policy).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { decryptSecret } from '@/lib/crypto';
import { db } from '@/lib/db/rls-pool';
import {
  decidePassage,
  decisionLabel,
  feedbackFor,
  type GateDirection,
  type PassageState,
} from '@/lib/scanner/passage';
import { qrPolicyDecision } from '@/lib/scanner/qr-policy';
import { parsePrintToken, verifyPrintTokenForEvent } from '@/lib/tickets/print-token';
import { verifyTotpCode } from '@/lib/totp/verify';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    ticketId: z.string().regex(/^[0-9a-f-]{36}$/i).optional(),
    /** Tištěná vstupenka (TXP2 vázaný na akci) — skener ho posílá místo ticketId. */
    printToken: z.string().min(8).max(80).optional(),
    totpCode: z.string().regex(/^\d{6}$/).optional(),
    gateId: z.string().uuid().optional(),
  })
  .refine((d) => d.ticketId || d.printToken, { message: 'ticketId nebo printToken je vyžadován' });

interface TicketRow {
  id: string;
  status: string;
  scan_count: number;
  currently_inside: boolean;
  totp_secret_encrypted: Buffer;
  event_id: string;
  event_title: string;
  event_promoter_id: string;
  event_qr_policy: string | null;
  event_date_start: string | null;
  reentry_allowed: boolean;
  reentry_max: number;
  cooldown_seconds: number;
  ticket_type_name: string;
  holder_name: string | null;
  buyer_email: string | null;
  sector: string | null;
  row: string | null;
  seat_number: string | null;
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'BAD_INPUT', issues: parsed.error.issues }, { status: 422 });
    }
    const { totpCode, gateId } = parsed.data;
    // Tištěná vstupenka: token se tady jen rozparsuje, podpis jde ověřit až proti akci z DB.
    let ticketId = parsed.data.ticketId;
    const printToken = !ticketId && parsed.data.printToken ? parsed.data.printToken : null;
    if (printToken) {
      const pt = parsePrintToken(printToken);
      if (!pt) {
        return NextResponse.json(
          { result: 'invalid_token', message: 'Neplatný kód vstupenky (podpis nesedí).' },
          { status: 401 },
        );
      }
      ticketId = pt.ticketId;
    }

    const client = await db().connect();
    try {
      await client.query('BEGIN');

      const tr = await client.query<TicketRow>(
        // Vstupenka nemá `event_id` — akce se dohledává přes objednávku,
        // stejně jako to dělá zbytek skenování.
        `SELECT t.id, t.status, t.scan_count, t.currently_inside, t.totp_secret_encrypted,
                t.holder_name,
                e.id AS event_id, e.title AS event_title, e.promoter_id AS event_promoter_id,
                e.qr_policy AS event_qr_policy, e.date_start AS event_date_start,
                COALESCE(e.reentry_allowed, FALSE) AS reentry_allowed,
                COALESCE(e.reentry_max_count, 3) AS reentry_max,
                COALESCE(e.reentry_cooldown_seconds, 10) AS cooldown_seconds,
                tt.name AS ticket_type_name,
                u.email AS buyer_email,
                es.sector, es.row, es.seat_number
         FROM tickets.tickets t
         JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
         JOIN orders.orders o ON o.id = t.order_id
         JOIN catalog.events e ON e.id = o.event_id
         LEFT JOIN identity.users u ON u.id = t.owner_id
         LEFT JOIN catalog.event_seats es ON es.id = t.event_seat_id
         WHERE t.id = $1
         FOR UPDATE OF t`,
        [ticketId],
      );
      const t = tr.rows[0];
      if (!t) {
        await client.query('ROLLBACK');
        return NextResponse.json({ result: 'not_found' }, { status: 404 });
      }
      if (t.event_promoter_id !== promoter.promoterId) {
        await client.query('ROLLBACK');
        return NextResponse.json({ result: 'wrong_promoter' }, { status: 403 });
      }
      if (!t.reentry_allowed) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            result: 'reentry_disabled',
            message: 'Akce nemá povolený opakovaný vstup. Použij běžné odbavení.',
          },
          { status: 422 },
        );
      }
      if (t.status === 'revoked') {
        await client.query('ROLLBACK');
        return NextResponse.json({ result: 'revoked' }, { status: 409 });
      }
      if (t.status !== 'valid') {
        await client.query('ROLLBACK');
        return NextResponse.json({ result: 'invalid_status', status: t.status }, { status: 409 });
      }

      let printVerifiedForEvent = false;
      if (printToken) {
        const pv = verifyPrintTokenForEvent(printToken, t.event_id);
        if (!pv.ok) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { result: 'invalid_token', message: 'Neplatný kód vstupenky (podpis nesedí).' },
            { status: 401 },
          );
        }
        printVerifiedForEvent = pv.scheme === 'TXP2';
      }
      const qr = qrPolicyDecision({
        qrPolicy: t.event_qr_policy,
        eventDateStart: t.event_date_start,
        printVerifiedForEvent,
      });
      if (qr.totpRequired && !totpCode) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { result: 'totp_required', qrPolicy: qr.qrPolicy, message: qr.message },
          { status: 401 },
        );
      }

      if (totpCode) {
        const secretB64 = decryptSecret(t.totp_secret_encrypted.toString('base64'));
        if (!verifyTotpCode(totpCode, Buffer.from(secretB64, 'base64'), { window: 1 })) {
          await client.query('ROLLBACK');
          return NextResponse.json({ result: 'totp_mismatch' }, { status: 401 });
        }
      }

      // Poslední nezrušený sken — kvůli prodlevě proti dvojímu načtení.
      const lastScan = await client.query<{ scan_type: string; scanned_at: string }>(
        `SELECT scan_type, scanned_at
         FROM tickets.scan_events
         WHERE ticket_id = $1 AND undone_at IS NULL
         ORDER BY scanned_at DESC, id DESC
         LIMIT 1`,
        [ticketId],
      );
      const last = lastScan.rows[0];

      let gateDirection: GateDirection = 'both';
      if (gateId) {
        const g = await client.query<{ direction: GateDirection }>(
          `SELECT direction FROM catalog.venue_gates WHERE id = $1`,
          [gateId],
        );
        gateDirection = g.rows[0]?.direction ?? 'both';
      }

      const state: PassageState = {
        currentlyInside: t.currently_inside,
        scanCount: t.scan_count,
        lastScanAt: last ? new Date(last.scanned_at) : null,
        lastDirection: last ? (last.scan_type === 'exit' ? 'exit' : 'entry') : null,
      };

      const decision = decidePassage(
        state,
        {
          maxEntries: t.reentry_max,
          cooldownSeconds: t.cooldown_seconds,
          gateDirection,
        },
        new Date(),
      );

      const holder = {
        ticketId: t.id,
        eventTitle: t.event_title,
        ticketTypeName: t.ticket_type_name,
        holderName: t.holder_name,
        holderEmail: t.buyer_email,
        seat: t.sector
          ? `${t.sector} · řada ${t.row ?? '?'} · sedadlo ${t.seat_number ?? '?'}`
          : null,
      };

      if (decision.kind === 'reject') {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            result: 'denied',
            reason: decision.reason,
            message: decision.message,
            label: decisionLabel(decision),
            feedback: feedbackFor(decision),
            ticket: holder,
          },
          { status: 409 },
        );
      }

      // Dvojí načtení: stav se nemění, obsluze se zopakuje předchozí výsledek.
      if (decision.kind === 'duplicate') {
        await client.query('ROLLBACK');
        return NextResponse.json({
          result: 'duplicate',
          direction: decision.direction,
          secondsSinceLastScan: decision.secondsSinceLastScan,
          label: decisionLabel(decision),
          feedback: feedbackFor(decision),
          message: `Tahle vstupenka byla načtena před ${decision.secondsSinceLastScan} s. Nic se nezměnilo.`,
          ticket: holder,
        });
      }

      let scanEventId: string;
      if (decision.kind === 'admit') {
        await client.query(
          `UPDATE tickets.tickets
           SET scan_count = $2, currently_inside = TRUE, last_entry_at = NOW(), updated_at = NOW()
           WHERE id = $1`,
          [t.id, decision.newScanCount],
        );
        const ins = await client.query<{ id: string }>(
          `INSERT INTO tickets.scan_events (ticket_id, event_id, scan_type, scanned_by_user_id, gate_id)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [t.id, t.event_id, decision.firstEntry ? 'entry' : 'reentry', promoter.userId, gateId ?? null],
        );
        scanEventId = ins.rows[0].id;
      } else {
        await client.query(
          `UPDATE tickets.tickets
           SET currently_inside = FALSE, last_exit_at = NOW(), updated_at = NOW()
           WHERE id = $1`,
          [t.id],
        );
        const ins = await client.query<{ id: string }>(
          `INSERT INTO tickets.scan_events (ticket_id, event_id, scan_type, scanned_by_user_id, gate_id)
           VALUES ($1,$2,'exit',$3,$4) RETURNING id`,
          [t.id, t.event_id, promoter.userId, gateId ?? null],
        );
        scanEventId = ins.rows[0].id;
      }

      // Kolik lidí je teď uvnitř. Do teď se `currently_inside` zapisovalo
      // a nikde nečetlo — přitom je to údaj, který produkce potřebuje nejvíc.
      const occ = await client.query<{ inside: string }>(
        `SELECT COUNT(*)::text AS inside
         FROM tickets.tickets tk
         JOIN orders.orders o ON o.id = tk.order_id
         WHERE o.event_id = $1 AND tk.currently_inside = TRUE AND tk.revoked_at IS NULL`,
        [t.event_id],
      );

      await client.query('COMMIT');

      return NextResponse.json({
        result: decision.kind === 'admit' ? 'admitted' : 'released',
        direction: decision.direction,
        label: decisionLabel(decision),
        feedback: feedbackFor(decision),
        /** Pro tlačítko „opravit" — vezme zpět přesně tenhle sken. */
        scanEventId,
        scanCount: decision.kind === 'admit' ? decision.newScanCount : t.scan_count,
        remainingEntries:
          decision.kind === 'admit' ? decision.remainingEntries : t.reentry_max - t.scan_count,
        occupancy: Number(occ.rows[0]?.inside ?? 0),
        ticket: holder,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[scanner/passage]', err);
      return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
