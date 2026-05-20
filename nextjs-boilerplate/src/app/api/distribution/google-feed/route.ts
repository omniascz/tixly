/**
 * GET /api/distribution/google-feed
 *
 * Public feed pro Google Things to Do — Schema.org Event JSON-LD format.
 * Indexovatelné Google Search-em → kupci najdou akci ve výsledcích a kliknou
 * na Tixly. Public, no auth.
 *
 * Pro produkci: registrovat URL v Google Search Console + Things to Do feeds.
 * Update typicky 1× za 24h (cron).
 */

import { NextResponse } from 'next/server';
import { Pool } from 'pg';

export const dynamic = 'force-dynamic';


let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface FeedRow {
  id: string;
  title: string;
  description: string | null;
  date_start: string;
  venue_name: string | null;
  venue_address: string | null;
  venue_city: string | null;
  min_price: number | null;
  promoter_name: string | null;
}

export async function GET(): Promise<Response> {
  const r = await db().query<FeedRow>(
    `SELECT
       e.id, e.title, e.description, e.date_start,
       v.name AS venue_name, v.address AS venue_address, v.city AS venue_city,
       (SELECT MIN(base_price) FROM catalog.ticket_types WHERE event_id = e.id) AS min_price,
       p.name AS promoter_name
     FROM catalog.events e
     LEFT JOIN catalog.venues v ON v.id = e.venue_id
     LEFT JOIN platform.promoters p ON p.id = e.promoter_id
     WHERE e.status = 'published'
       AND e.date_start > NOW()
     ORDER BY e.date_start ASC
     LIMIT 500`,
  );

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  const events = r.rows.map((row) => ({
    '@context': 'https://schema.org',
    '@type': 'Event',
    '@id': `${baseUrl}/cs/events/${row.id}`,
    name: row.title,
    description: row.description ?? undefined,
    startDate: row.date_start,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: row.venue_name
      ? {
          '@type': 'Place',
          name: row.venue_name,
          address: {
            '@type': 'PostalAddress',
            streetAddress: row.venue_address ?? undefined,
            addressLocality: row.venue_city ?? undefined,
            addressCountry: 'CZ',
          },
        }
      : {
          '@type': 'VirtualLocation',
          url: `${baseUrl}/cs/events/${row.id}`,
        },
    organizer: row.promoter_name
      ? {
          '@type': 'Organization',
          name: row.promoter_name,
        }
      : undefined,
    offers:
      row.min_price !== null
        ? {
            '@type': 'Offer',
            url: `${baseUrl}/cs/events/${row.id}`,
            price: (row.min_price / 100).toFixed(2),
            priceCurrency: 'CZK',
            availability: 'https://schema.org/InStock',
            validFrom: new Date().toISOString(),
          }
        : undefined,
  }));

  return NextResponse.json({
    '@context': 'https://schema.org',
    '@graph': events,
    feedInfo: {
      provider: 'Tixly',
      generatedAt: new Date().toISOString(),
      count: events.length,
    },
  });
}
