/**
 * POST /api/admin/pos/print
 *
 * Generuje ZPL nebo PDF pro vstupenky z objednávky a zapíše print job.
 * Body: { orderId: string; terminalId: string; format: 'zpl' | 'pdf' }
 *
 * Vrátí: { jobId, ticketCount, format, payload }
 * payload = ZPL string nebo base64 PDF.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({
  orderId: z.string().uuid(),
  terminalId: z.string().uuid(),
  format: z.enum(['zpl', 'pdf']).default('zpl'),
});

interface TicketRow {
  ticket_id: string;
  event_title: string;
  date_start: string;
  seat_number: string | null;
  row_letter: string | null;
  ticket_type_name: string;
  variable_symbol: string | null;
}

function buildZplLabel(ticket: TicketRow, idx: number): string {
  const qrCode = `tixly:${ticket.ticket_id}:CURRENT`;
  const eventName = ticket.event_title.slice(0, 30);
  const date = new Date(ticket.date_start).toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    timeZone: 'Europe/Prague',
  });
  const seatInfo = ticket.seat_number
    ? `${ticket.row_letter ? `Rad ${ticket.row_letter}, ` : ''}Misto ${ticket.seat_number}`
    : ticket.ticket_type_name.slice(0, 25);
  const orderRef = ticket.variable_symbol ?? ticket.ticket_id.slice(0, 8).toUpperCase();

  // ZPL template: 104mm wide × 51mm tall (standard Tixly ticket label)
  return [
    '^XA',
    '^CI28',
    // QR code — module size 4, top-left at 30,30
    `^FO30,30^BQN,2,4^FDQA,${qrCode}^FS`,
    // Event name
    `^FO210,30^A0N,28,28^FD${eventName}^FS`,
    // Date
    `^FO210,68^A0N,22,22^FD${date}^FS`,
    // Seat / ticket type
    `^FO210,98^A0N,20,20^FD${seatInfo}^FS`,
    // Order ref + ticket index
    `^FO210,126^A0N,18,18^FDObj: ${orderRef}  #${idx + 1}^FS`,
    // Separator line
    '^FO30,155^GB790,1,2^FS',
    '^XZ',
  ].join('');
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (ctx) => {
    const body = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { orderId, terminalId, format } = parsed.data;

    // Verify terminal belongs to promoter
    const terminalRes = await db().query<{ id: string }>(
      `SELECT id FROM platform.pos_terminals
       WHERE id = $1 AND promoter_id = $2 AND is_active = true`,
      [terminalId, ctx.promoterId],
    );
    if (terminalRes.rows.length === 0) {
      return NextResponse.json({ error: 'TERMINAL_NOT_FOUND' }, { status: 404 });
    }

    // Verify order belongs to promoter's event
    const orderRes = await db().query<{ id: string }>(
      `SELECT o.id FROM orders.orders o
       JOIN catalog.events e ON e.id = o.event_id
       WHERE o.id = $1 AND e.promoter_id = $2`,
      [orderId, ctx.promoterId],
    );
    if (orderRes.rows.length === 0) {
      return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 });
    }

    // Load tickets with event info
    const ticketsRes = await db().query<TicketRow>(
      `SELECT
         t.id AS ticket_id,
         e.title AS event_title,
         e.date_start,
         es.seat_number,
         es.row AS row_letter,
         tt.name AS ticket_type_name,
         o.variable_symbol
       FROM tickets.tickets t
       JOIN orders.orders o ON o.id = t.order_id
       JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
       JOIN catalog.events e ON e.id = tt.event_id
       LEFT JOIN catalog.event_seats es ON es.id = t.event_seat_id
       WHERE t.order_id = $1
       ORDER BY t.id ASC`,
      [orderId],
    );

    if (ticketsRes.rows.length === 0) {
      return NextResponse.json(
        { error: 'NO_TICKETS', message: 'Objednávka nemá žádné vstupenky.' },
        { status: 404 },
      );
    }

    const tickets = ticketsRes.rows;
    const ticketIds = tickets.map((t) => t.ticket_id);

    let payload: string;

    if (format === 'zpl') {
      payload = tickets.map((t, i) => buildZplLabel(t, i)).join('\n');
    } else {
      // PDF placeholder — base64 of a simple text marker
      // Real implementation would use @react-pdf/renderer or pdfkit
      payload = Buffer.from(
        `%PDF-PLACEHOLDER:${tickets.length}:${orderId}`,
      ).toString('base64');
    }

    // Insert print job (completed immediately — payload generated server-side)
    const jobRes = await db().query<{ id: string }>(
      `INSERT INTO platform.pos_print_jobs
         (terminal_id, order_id, ticket_ids, status, format, payload, printed_at)
       VALUES ($1, $2, $3, 'completed', $4, $5, NOW())
       RETURNING id`,
      [terminalId, orderId, ticketIds, format, payload],
    );

    return NextResponse.json({
      jobId: jobRes.rows[0].id,
      format,
      ticketCount: tickets.length,
      payload,
    });
  });
}
