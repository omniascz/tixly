/**
 * POST /api/admin/scanner/passage/undo
 *
 * Vezme poslední průchod zpět.
 *
 * Když se na displeji zobrazí opačný směr, než kterým člověk jde, obsluha
 * **nesmí pípnout znovu** — druhé pípnutí by stav sice překlopilo zpátky, ale
 * zároveň zapsalo další průchod a u vstupu naúčtovalo další vstup z limitu.
 * Při limitu tří návratů by tak dvě chybná pípnutí připravila člověka o jeden.
 *
 * Vrácený sken zůstává v tabulce s časem a jménem toho, kdo ho vrátil.
 * Je to zásah do evidence průchodů, takže musí být dohledatelný.
 *
 * Body: { scanEventId } — id vrácené z `/scanner/passage`
 *        nebo { ticketId } — vezme poslední nezrušený sken vstupenky
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';
import { undoScan, type Direction } from '@/lib/scanner/passage';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    scanEventId: z.string().uuid().optional(),
    ticketId: z.string().regex(/^[0-9a-f-]{36}$/i).optional(),
    reason: z.string().max(200).optional(),
  })
  .refine((d) => Boolean(d.scanEventId) || Boolean(d.ticketId), {
    message: 'Zadej scanEventId nebo ticketId.',
  });

interface ScanRow {
  id: string;
  ticket_id: string;
  event_id: string;
  scan_type: string;
  scanned_at: string;
  undone_at: string | null;
  promoter_id: string;
  scan_count: number;
  currently_inside: boolean;
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'BAD_INPUT', issues: parsed.error.issues }, { status: 422 });
    }

    const client = await db().connect();
    try {
      await client.query('BEGIN');

      const where = parsed.data.scanEventId
        ? `se.id = $1`
        : `se.ticket_id = $1 AND se.undone_at IS NULL`;
      const arg = parsed.data.scanEventId ?? parsed.data.ticketId;

      const sr = await client.query<ScanRow>(
        `SELECT se.id, se.ticket_id, se.event_id, se.scan_type, se.scanned_at::text, se.undone_at,
                e.promoter_id, t.scan_count, t.currently_inside
         FROM tickets.scan_events se
         JOIN catalog.events e ON e.id = se.event_id
         JOIN tickets.tickets t ON t.id = se.ticket_id
         WHERE ${where}
         ORDER BY se.scanned_at DESC, se.id DESC
         LIMIT 1
         FOR UPDATE OF t`,
        [arg],
      );
      const scan = sr.rows[0];
      if (!scan) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'NOT_FOUND', message: 'Sken nenalezen.' }, { status: 404 });
      }
      if (scan.promoter_id !== promoter.promoterId) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
      }
      if (scan.undone_at !== null) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'ALREADY_UNDONE', message: 'Tenhle sken už byl vzatý zpět.' },
          { status: 409 },
        );
      }

      // Vracet lze jen poslední průchod. Kdyby šlo vrátit starší, stav
      // vstupenky by přestal odpovídat posloupnosti skenů.
      const newest = await client.query<{ id: string }>(
        `SELECT id FROM tickets.scan_events
         WHERE ticket_id = $1 AND undone_at IS NULL
         ORDER BY scanned_at DESC, id DESC LIMIT 1`,
        [scan.ticket_id],
      );
      if (newest.rows[0]?.id !== scan.id) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'NOT_LAST_SCAN',
            message: 'Vzít zpět lze jen poslední průchod. Mezitím proběhl další sken.',
          },
          { status: 409 },
        );
      }

      const direction: Direction = scan.scan_type === 'exit' ? 'exit' : 'entry';
      const next = undoScan(
        {
          currentlyInside: scan.currently_inside,
          scanCount: scan.scan_count,
          lastScanAt: new Date(scan.scanned_at),
          lastDirection: direction,
        },
        direction,
      );

      await client.query(
        `UPDATE tickets.tickets
         SET currently_inside = $2, scan_count = $3, updated_at = NOW()
         WHERE id = $1`,
        [scan.ticket_id, next.currentlyInside, next.scanCount],
      );

      await client.query(
        `UPDATE tickets.scan_events
         SET undone_at = NOW(), undone_by_user_id = $2, undo_reason = $3
         WHERE id = $1`,
        [scan.id, promoter.userId, parsed.data.reason ?? null],
      );

      await client.query(
        `INSERT INTO audit.audit_log
           (schema_name, table_name, record_id, action, actor_id, actor_type, new_values)
         VALUES ('tickets','scan_events',$1,'UPDATE',$2,'user',$3::jsonb)`,
        [
          scan.id,
          promoter.userId,
          JSON.stringify({
            kind: 'passage_undo',
            ticket_id: scan.ticket_id,
            undone_direction: direction,
            reason: parsed.data.reason ?? null,
          }),
        ],
      );

      const occ = await client.query<{ inside: string }>(
        `SELECT COUNT(*)::text AS inside
         FROM tickets.tickets tk
         JOIN orders.orders o ON o.id = tk.order_id
         WHERE o.event_id = $1 AND tk.currently_inside = TRUE AND tk.revoked_at IS NULL`,
        [scan.event_id],
      );

      await client.query('COMMIT');

      return NextResponse.json({
        ok: true,
        undoneDirection: direction,
        currentlyInside: next.currentlyInside,
        scanCount: next.scanCount,
        occupancy: Number(occ.rows[0]?.inside ?? 0),
        message:
          direction === 'entry'
            ? 'Vstup vzat zpět — držitel je veden jako venku a vstup se nezapočítal.'
            : 'Odchod vzat zpět — držitel je veden jako uvnitř.',
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[scanner/passage/undo]', err);
      return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
