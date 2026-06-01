/**
 * GET /api/buyer/tickets/[ticketId]/wallet/google
 *
 * Vrátí { saveUrl, jwt } — frontend renderuje "Add to Google Wallet" button
 * přesměrovávající na Google Pay save endpoint.
 *
 * Production: vyžaduje Google Service Account + RS256 keypair pro signed JWT.
 * Demo: vrací HMAC-signed JWT (placeholder).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { buildGoogleWalletJwt } from '@/lib/wallet/google-wallet';


export async function GET(
  req: NextRequest,
  { params }: { params: { ticketId: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const r = await db().query<{
    id: string;
    event_title: string;
    event_date: string;
    venue_name: string | null;
    ticket_type_name: string;
    buyer_email: string;
    buyer_name: string | null;
    promoter_name: string | null;
    brand_color_hex: string | null;
    brand_logo_url: string | null;
  }>(
    `SELECT t.id,
            e.title AS event_title,
            e.date_start AS event_date,
            v.name AS venue_name,
            tt.name AS ticket_type_name,
            u.email AS buyer_email,
            u.name AS buyer_name,
            p.name AS promoter_name,
            p.brand_color_hex,
            p.brand_logo_url
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
  const row = r.rows[0];

  const out = buildGoogleWalletJwt({
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
  });

  return NextResponse.json({
    saveUrl: out.saveUrl,
    signed: out.signed,
    walletStatus: out.signed ? 'signed' : 'unsigned-demo',
    note: out.signed
      ? null
      : 'Pro produkční fungování nastav GOOGLE_WALLET_PRIVATE_KEY_PEM (Service Account RS256).',
  });

  });
}
