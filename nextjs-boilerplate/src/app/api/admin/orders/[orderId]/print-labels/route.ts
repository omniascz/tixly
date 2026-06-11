/**
 * GET /api/admin/orders/[orderId]/print-labels
 *
 * Vrátí PDF s TIŠTĚNÝMI vstupenkami objednávky ve formátu 152×51 mm (à la
 * SMSticket / Zebra GK420d). Box office to otevře a vytiskne na termotiskárnu
 * se štítkovým kartonem. Každý lístek = jedna stránka, QR nese podepsaný print
 * token (viz [[tickets/print-token]]), který odbaví scanner.
 *
 * Promoter-scoped (RLS + explicitní ownership check). Pouze valid/used lístky.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';
import { renderTicketLabelPdf, type LabelTicket } from '@/lib/tickets/label-pdf';

interface OrderRow {
  id: string;
  buyer_name: string | null;
  buyer_email: string;
  event_title: string;
  event_date_start: string | null;
  venue_name: string | null;
  promoter_name: string | null;
  brand_color_hex: string | null;
}

interface TicketRow {
  ticket_id: string;
  ticket_type_name: string;
  unit_price: number | null;
  sector: string | null;
  row: string | null;
  seat_number: string | null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
    const { orderId } = await params;

    const orderRes = await db().query<OrderRow>(
      `SELECT o.id,
              u.name AS buyer_name, u.email AS buyer_email,
              e.title AS event_title, e.date_start AS event_date_start,
              v.name AS venue_name,
              p.name AS promoter_name,
              p.brand_color_hex
         FROM orders.orders o
         JOIN identity.users u ON u.id = o.user_id
         LEFT JOIN catalog.events e ON e.id = o.event_id
         LEFT JOIN catalog.venues v ON v.id = e.venue_id
         LEFT JOIN platform.promoters p ON p.id = e.promoter_id
        WHERE o.id = $1 AND e.promoter_id = $2`,
      [orderId, promoter.promoterId],
    );
    if (orderRes.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    const order = orderRes.rows[0];

    const ticketsRes = await db().query<TicketRow>(
      `SELECT t.id AS ticket_id, tt.name AS ticket_type_name, oi.unit_price,
              es.sector, es.row, es.seat_number
         FROM tickets.tickets t
         JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
         JOIN orders.order_items oi
           ON oi.order_id = t.order_id AND oi.ticket_type_id = t.ticket_type_id
         LEFT JOIN catalog.event_seats es ON es.id = t.event_seat_id
        WHERE t.order_id = $1 AND t.status IN ('valid', 'used')
        ORDER BY tt.name, es.row, es.seat_number`,
      [orderId],
    );
    if (ticketsRes.rows.length === 0) {
      return NextResponse.json(
        { error: 'NO_TICKETS', message: 'Objednávka nemá vystavené lístky k tisku.' },
        { status: 409 },
      );
    }

    const tickets: LabelTicket[] = ticketsRes.rows.map((r) => ({
      ticketId: r.ticket_id,
      ticketTypeName: r.ticket_type_name,
      unitPriceHalire: r.unit_price,
      seatLabel: r.sector
        ? `${r.sector} · řada ${r.row ?? '?'} · sedadlo ${r.seat_number ?? '?'}`
        : null,
    }));

    const pdf = await renderTicketLabelPdf(
      {
        eventTitle: order.event_title,
        eventDateStart: order.event_date_start,
        venueName: order.venue_name,
        buyerName: order.buyer_name ?? order.buyer_email,
        promoterName: order.promoter_name,
        brandColorHex: order.brand_color_hex,
      },
      tickets,
    );

    return new NextResponse(pdf as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="vstupenky-${order.id.slice(0, 8)}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  });
}
