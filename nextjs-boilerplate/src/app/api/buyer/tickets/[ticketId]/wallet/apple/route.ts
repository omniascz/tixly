/**
 * GET /api/buyer/tickets/[ticketId]/wallet/apple
 *
 * Vrátí Apple Wallet pass.json. V produkci by zde byl signed .pkpass binary
 * (ZIP s pass.json + assets + manifest + PKCS#7 signature).
 * V demu vrací jen pass.json content (Content-Type: application/json) s hlavičkou
 * X-Wallet-Status: unsigned-demo.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { buildPassJson } from '@/lib/wallet/apple-pass';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { ticketId: string } },
): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const r = await db().query<{
    id: string;
    event_title: string;
    event_date: string;
    venue_name: string | null;
    ticket_type_name: string;
    buyer_email: string;
    buyer_name: string | null;
    promoter_name: string | null;
  }>(
    `SELECT t.id,
            e.title AS event_title,
            e.date_start AS event_date,
            v.name AS venue_name,
            tt.name AS ticket_type_name,
            u.email AS buyer_email,
            u.name AS buyer_name,
            p.name AS promoter_name
     FROM tickets.tickets t
     JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
     JOIN orders.orders o ON o.id = t.order_id
     JOIN catalog.events e ON e.id = o.event_id
     LEFT JOIN catalog.venues v ON v.id = e.venue_id
     LEFT JOIN platform.promoters p ON p.id = e.promoter_id
     JOIN identity.users u ON u.id = t.owner_id
     WHERE t.id = $1 AND t.owner_id = $2 AND t.status = 'valid'`,
    [params.ticketId, userId],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const row = r.rows[0]!;

  const pass = buildPassJson({
    ticketId: row.id,
    eventTitle: row.event_title,
    eventDateIso: row.event_date,
    ticketTypeName: row.ticket_type_name,
    holderName: row.buyer_name,
    holderEmail: row.buyer_email,
    venueName: row.venue_name,
    qrPayload: `tixly://ticket/${row.id}`,
    organizationName: row.promoter_name ?? 'Tixly',
  });

  return new NextResponse(JSON.stringify(pass, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'X-Wallet-Status': 'unsigned-demo',
      'X-Wallet-Note': 'Production deployment requires Apple Pass Type ID certificate to sign the .pkpass bundle.',
    },
  });
}
