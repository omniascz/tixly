/**
 * GET /api/resale/marketplace
 *
 * Public marketplace — všechny aktivní listings, joined s eventem a typem vstupenky.
 * Neautentizováno, ale citlivá data (seller email) zůstávají na serveru.
 */

import { NextResponse } from 'next/server';
import { Pool } from 'pg';

export const dynamic = 'force-dynamic';


let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface MarketRow {
  listing_id: string;
  ticket_id: string;
  ask_price: number;
  original_price: number;
  listed_at: string;
  expires_at: string;
  event_id: string;
  event_title: string;
  event_date_start: string;
  venue_name: string | null;
  ticket_type_name: string;
  promoter_name: string | null;
  promoter_slug: string | null;
  brand_color_hex: string | null;
}

export async function GET(): Promise<Response> {
  const r = await db().query<MarketRow>(
    `SELECT
       l.id AS listing_id, l.ticket_id, l.ask_price, l.original_price,
       l.listed_at, l.expires_at,
       e.id AS event_id, e.title AS event_title, e.date_start AS event_date_start,
       v.name AS venue_name,
       tt.name AS ticket_type_name,
       p.name AS promoter_name, p.slug AS promoter_slug, p.brand_color_hex
     FROM resale.resale_listings l
     JOIN tickets.tickets t ON t.id = l.ticket_id
     JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
     JOIN orders.orders o ON o.id = t.order_id
     JOIN catalog.events e ON e.id = o.event_id
     LEFT JOIN catalog.venues v ON v.id = e.venue_id
     LEFT JOIN platform.promoters p ON p.id = e.promoter_id
     WHERE l.status = 'active'
       AND l.expires_at > NOW()
       AND e.date_start > NOW()
     ORDER BY l.listed_at DESC
     LIMIT 50`,
  );

  return NextResponse.json({
    listings: r.rows.map((row) => ({
      listingId: row.listing_id,
      ticketId: row.ticket_id,
      askPriceHalire: row.ask_price,
      originalPriceHalire: row.original_price,
      listedAt: row.listed_at,
      expiresAt: row.expires_at,
      event: {
        id: row.event_id,
        title: row.event_title,
        dateStart: row.event_date_start,
        venueName: row.venue_name,
      },
      ticketTypeName: row.ticket_type_name,
      promoter: row.promoter_name
        ? {
            name: row.promoter_name,
            slug: row.promoter_slug,
            brandColorHex: row.brand_color_hex,
          }
        : null,
    })),
  });
}
