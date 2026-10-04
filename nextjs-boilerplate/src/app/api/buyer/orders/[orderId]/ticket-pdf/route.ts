/**
 * GET /api/buyer/orders/[orderId]/ticket-pdf
 *
 * Buyer si může znovu stáhnout PDF vstupenku (např. ztratil email).
 * Respektuje qr_policy:
 *   - rotating_only → 403 MOBILE_ONLY (žádné statické PDF pro anti-scalping)
 *   - ostatní (static_allowed, rotating_24h, photo_required) → vrátí PDF
 *
 * Auth: x-user-id header (musí být vlastník objednávky).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithUserContext } from '@/lib/db/rls-pool';
import { renderTicketsPdf } from '@/lib/tickets/pdf-renderer';
import { renderFanTicketPdf } from '@/lib/tickets/fan-ticket-renderer';

export async function GET(
  req: NextRequest,
  { params }: { params: { orderId: string } },
): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!/^[0-9a-f-]{36}$/i.test(params.orderId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
  }

  // Kolo 2 / V2: dotazy MUSÍ běžet v kontextu kupce — bez něj RLS pod tixly_app
  // objednávku neukáže a PDF končilo 404 (pod vlastníkem DB to „fungovalo" jen díky BYPASSRLS).
  return runWithUserContext(userId, async () => {
  const r = await db().query<{
    id: string;
    user_id: string;
    event_title: string;
    event_date_start: string;
    qr_policy: string;
    venue_name: string | null;
    promoter_name: string | null;
    buyer_email: string;
    buyer_name: string | null;
    brand_color_hex: string | null;
    brand_logo_url: string | null;
    vat_rate_pct: number | null;
    fan_ticket_enabled: boolean;
    fan_artwork_url: string | null;
  }>(
    `SELECT o.id, o.user_id,
            e.title AS event_title,
            e.date_start::text AS event_date_start,
            COALESCE(e.qr_policy, 'rotating_24h') AS qr_policy,
            e.fan_ticket_enabled,
            e.fan_artwork_url,
            v.name AS venue_name,
            p.name AS promoter_name,
            u.email AS buyer_email,
            u.name AS buyer_name,
            p.brand_color_hex,
            p.brand_logo_url,
            p.vat_rate_pct
     FROM orders.orders o
     JOIN catalog.events e ON e.id = o.event_id
     JOIN identity.users u ON u.id = o.user_id
     LEFT JOIN catalog.venues v ON v.id = e.venue_id
     LEFT JOIN platform.promoters p ON p.id = e.promoter_id
     WHERE o.id = $1 AND o.status = 'paid'`,
    [params.orderId],
  );

  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'Order not found or not paid' }, { status: 404 });
  }

  const order = r.rows[0];

  // Ownership check
  if (order.user_id !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Mobile-only policy gate — statické PDF nedovoleno
  if (order.qr_policy === 'rotating_only') {
    return NextResponse.json(
      {
        error: 'MOBILE_ONLY',
        message:
          'Tato akce používá mobilní vstupenky (SafeTix). PDF ke stažení není dostupné — ' +
          'vstupenku zobrazíte v aplikaci Tixly nebo přes odkaz v emailu.',
      },
      { status: 403 },
    );
  }

  // Kolo 2: jen ČTENÍ už vystavených vstupenek. Dřív se volal issuer
  // (issueTicketsForOrder), který při prázdném výsledku vstupenky VYSTAVIL — z požadavku
  // kupce, pod jeho kontextem. Vystavení patří výhradně do order-completed (servis).
  // TOTP secret se do PDF nevkládá (issuer ho pro existující vstupenky také vracel prázdný).
  let issued: Array<{ ticketId: string; ticketTypeName: string; totpSecretBase32: string }> = [];
  try {
    const tr = await db().query<{ id: string; ticket_type_name: string }>(
      `SELECT t.id, tt.name AS ticket_type_name
         FROM tickets.tickets t
         JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
        WHERE t.order_id = $1 AND t.status IN ('valid', 'used')
        ORDER BY t.id`,
      [params.orderId],
    );
    issued = tr.rows.map((t) => ({ ticketId: t.id, ticketTypeName: t.ticket_type_name, totpSecretBase32: '' }));
  } catch (err) {
    console.error('[ticket-pdf] load tickets failed', err);
    return NextResponse.json({ error: 'Could not load tickets' }, { status: 500 });
  }

  if (issued.length === 0) {
    return NextResponse.json({ error: 'No tickets found' }, { status: 404 });
  }

  // Seat labels per ticket
  const priceRes = await db().query<{
    ticket_id: string;
    unit_price: number;
    sector: string | null;
    row: string | null;
    seat_number: string | null;
    price_category_name: string | null;
    proof_required_label: string | null;
  }>(
    `SELECT t.id AS ticket_id, oi.unit_price,
            es.sector, es.row, es.seat_number, t.price_category_name, t.proof_required_label
     FROM tickets.tickets t
     -- Kolo 8: u nákupu míst je víc položek téhož typu (kategorie) → položka podle místa vstupenky
       JOIN LATERAL (SELECT * FROM orders.order_items x WHERE x.order_id = t.order_id AND x.ticket_type_id = t.ticket_type_id
         ORDER BY (x.seat_id IS NOT DISTINCT FROM t.event_seat_id) DESC, x.id LIMIT 1) oi ON true
     LEFT JOIN catalog.event_seats es ON es.id = t.event_seat_id
     WHERE t.order_id = $1`,
    [params.orderId],
  );
  const metaById = new Map(
    priceRes.rows.map((r2) => [
      r2.ticket_id,
      {
        price: r2.unit_price,
        seat: r2.sector
          ? `${r2.sector} · řada ${r2.row ?? '?'} · sedadlo ${r2.seat_number ?? '?'}`
          : null,
        categoryName: r2.price_category_name,
        proofLabel: r2.proof_required_label,
      },
    ]),
  );

  // Fan Ticket: prémiový renderer (landscape, artwork) pro první vstupenku
  // Ostatní vstupenky v objednávce dostanou standardní PDF na dalších stránkách
  if (order.fan_ticket_enabled && order.fan_artwork_url && issued.length > 0) {
    const firstTicket = issued[0];
    const firstMeta   = metaById.get(firstTicket.ticketId);
    const fanBuf = await renderFanTicketPdf({
      eventTitle:        order.event_title,
      eventDateStart:    order.event_date_start,
      venueName:         order.venue_name,
      ticketTypeName:    firstTicket.ticketTypeName,
      seatLabel:         firstMeta?.seat ?? null,
      holderName:        order.buyer_name ?? '',
      holderEmail:       order.buyer_email,
      ticketId:          firstTicket.ticketId,
      orderId:           order.id,
      totpSecretBase32:  firstTicket.totpSecretBase32,
      brandColorHex:     order.brand_color_hex,
      artworkUrl:        order.fan_artwork_url,
      promoterName:      order.promoter_name,
    });
    const slug = (order.promoter_name ?? 'tixly')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20);
    return new Response(new Uint8Array(fanBuf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${slug}-fanticket-${params.orderId.slice(0, 8)}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  }

  const pdfBuf = await renderTicketsPdf(
    {
      eventTitle: order.event_title,
      eventDateStart: order.event_date_start,
      venueName: order.venue_name,
      buyerName: order.buyer_name ?? order.buyer_email,
      buyerEmail: order.buyer_email,
      orderId: order.id,
      promoterName: order.promoter_name,
      brandColorHex: order.brand_color_hex,
      brandLogoUrl: order.brand_logo_url,
      vatRatePct: order.vat_rate_pct ?? 10,
    },
    issued.map((t) => {
      const meta = metaById.get(t.ticketId);
      return {
        ticketId: t.ticketId,
        ticketTypeName: t.ticketTypeName,
        totpSecretBase32: t.totpSecretBase32,
        holderLabel: order.buyer_email,
        issuer: order.event_title,
        unitPriceHalire: meta?.price,
        seatLabel: meta?.seat ?? null,
        accessibleGateInfo: null,
        categoryName: meta?.categoryName ?? null,
        proofLabel: meta?.proofLabel ?? null,
      };
    }),
  );

  const slug = (order.promoter_name ?? 'tixly')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 20);

  return new Response(new Uint8Array(pdfBuf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${slug}-${params.orderId.slice(0, 8)}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
  });
}
