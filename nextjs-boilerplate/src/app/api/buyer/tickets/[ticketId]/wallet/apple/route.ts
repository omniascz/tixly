/**
 * GET /api/buyer/tickets/[ticketId]/wallet/apple
 *
 * Vrátí binární `.pkpass` (ZIP). Bez Apple Pass Type ID certifikátu vrátí
 * unsigned bundle — iOS ho odmítne, ale frontend pipeline lze otestovat.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { buildPkpass } from '@/lib/wallet/apple-pass';


export async function GET(
  req: NextRequest,
  { params }: { params: { ticketId: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const r = await db().query<{
    id: string;
    event_id: string;
    event_title: string;
    event_date: string;
    venue_name: string | null;
    ticket_type_name: string;
    buyer_email: string;
    buyer_name: string | null;
    promoter_name: string | null;
    brand_color_hex: string | null;
    brand_logo_url: string | null;
    sector: string | null;
    row_label: string | null;
    seat_number: string | null;
    accessibility: boolean | null;
  }>(
    `SELECT t.id, o.event_id,
            e.title AS event_title,
            e.date_start AS event_date,
            v.name AS venue_name,
            tt.name AS ticket_type_name,
            u.email AS buyer_email,
            u.name AS buyer_name,
            p.name AS promoter_name,
            p.brand_color_hex,
            p.brand_logo_url,
            es.sector, es.row AS row_label, es.seat_number, es.accessibility
     FROM tickets.tickets t
     JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
     JOIN orders.orders o ON o.id = t.order_id
     JOIN catalog.events e ON e.id = o.event_id
     LEFT JOIN catalog.venues v ON v.id = e.venue_id
     LEFT JOIN platform.promoters p ON p.id = e.promoter_id
     JOIN identity.users u ON u.id = t.owner_id
     LEFT JOIN catalog.event_seats es ON es.id = t.event_seat_id
     WHERE t.id = $1 AND t.owner_id = $2 AND t.status = 'valid'`,
    [params.ticketId, userId],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const row = r.rows[0];

  const seatLabel = row.sector
    ? `${row.sector} · řada ${row.row_label ?? '?'} · sedadlo ${row.seat_number ?? '?'}`
    : null;

  // Bezbariérový vstup (jen pro accessible sedadla)
  let accessibleGateInfo: string | null = null;
  if (row.accessibility && row.event_id) {
    const gateRes = await db().query<{ gate_label: string; notes: string | null }>(
      `SELECT vg.label AS gate_label, ez.accessible_gate_notes AS notes
         FROM catalog.event_zones ez
         JOIN catalog.venue_gates vg ON vg.id = ez.accessible_gate_id
        WHERE ez.event_id = $1 AND ez.accessible_gate_id IS NOT NULL
        ORDER BY vg.sort_order, vg.code LIMIT 3`,
      [row.event_id],
    ).catch(() => ({ rows: [] as { gate_label: string; notes: string | null }[] }));
    if (gateRes.rows.length > 0) {
      accessibleGateInfo = gateRes.rows
        .map((g) => `${g.gate_label}${g.notes ? ` — ${g.notes}` : ''}`)
        .join('; ');
    }
  }

  const out = buildPkpass({
    ticketId: row.id,
    eventTitle: row.event_title,
    eventDateIso: row.event_date,
    ticketTypeName: row.ticket_type_name,
    holderName: row.buyer_name,
    holderEmail: row.buyer_email,
    venueName: row.venue_name,
    qrPayload: `tixly://ticket/${row.id}`,
    organizationName: row.promoter_name ?? 'Tixly',
    brandColorHex: row.brand_color_hex,
    brandLogoUrl: row.brand_logo_url,
    seatLabel,
    accessibleGateInfo,
  });

  // Buffer → Uint8Array (BodyInit kompatibilní s NextResponse v Edge i Node runtime)
  return new NextResponse(new Uint8Array(out.buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': `attachment; filename="ticket-${row.id.slice(0, 8)}.pkpass"`,
      'X-Wallet-Signed': out.signed ? 'true' : 'false',
      // HTTP hlavičky musí být Latin1/ASCII — out.note je česky (em-pomlčka,
      // diakritika) → encode, jinak Response konstruktor padne na ByteString.
      ...(out.note ? { 'X-Wallet-Note': encodeURIComponent(out.note) } : {}),
    },
  });

  });
}
