/**
 * /signage/[venueId] — Digital signage availability screen pro foyer.
 *
 * Eventim Inhouse parita. Promotér / venue manager pustí na fullscreenu
 * v lobby — návštěvníci vidí aktuální dostupnost lístků v reálném čase.
 * Auto-refresh á 30s. Žádný buyer auth.
 *
 * URL: /signage/<venue_id>?promoterId=<optional>&theme=dark
 */
import { Pool } from 'pg';
import { pgPoolOptions } from '@/lib/db/pg-options';
import { SignageView } from './SignageView';

interface PageProps {
  params: Promise<{ venueId: string }>;
  searchParams: Promise<{ promoterId?: string; theme?: string }>;
}

interface EventAvail {
  id: string;
  title: string;
  date_start: string;
  category: string | null;
  promoter_name: string;
  total_capacity: number;
  remaining: number;
  cheapest_price: number;
  currency: string;
  is_sold_out: boolean;
  cover_image_url: string | null;
}

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool(pgPoolOptions(process.env.DATABASE_URL));
  return pool;
}

async function fetchVenueAvail(
  venueId: string,
  promoterId?: string,
): Promise<{ venueName: string | null; events: EventAvail[] }> {
  const venue = await db().query<{ name: string }>(
    `SELECT name FROM catalog.venues WHERE id = $1`,
    [venueId],
  );

  const conditions: string[] = [
    `e.venue_id = $1`,
    `e.status = 'published'`,
    `p.status = 'active'`,
    `e.date_start >= now()`,
    `e.date_start <= now() + INTERVAL '30 days'`,
  ];
  const args: unknown[] = [venueId];
  if (promoterId) {
    args.push(promoterId);
    conditions.push(`e.promoter_id = $${args.length}`);
  }

  const r = await db().query<EventAvail>(
    `SELECT e.id, e.title, e.date_start::text, e.category,
            p.name AS promoter_name,
            e.cover_image_url,
            COALESCE((SELECT SUM(total_qty) FROM catalog.ticket_types
                       WHERE event_id = e.id AND visibility = 'public'), 0)::int AS total_capacity,
            COALESCE((SELECT SUM(remaining_qty) FROM catalog.ticket_types
                       WHERE event_id = e.id AND visibility = 'public'), 0)::int AS remaining,
            COALESCE((SELECT MIN(base_price) FROM catalog.ticket_types
                       WHERE event_id = e.id AND visibility = 'public' AND remaining_qty > 0), 0)::int
              AS cheapest_price,
            COALESCE(e.currency, 'CZK') AS currency,
            COALESCE((SELECT bool_and(remaining_qty = 0) FROM catalog.ticket_types
                       WHERE event_id = e.id AND visibility = 'public'), false) AS is_sold_out
       FROM catalog.events e
       JOIN platform.promoters p ON p.id = e.promoter_id
      WHERE ${conditions.join(' AND ')}
   ORDER BY e.date_start
      LIMIT 20`,
    args,
  );

  return {
    venueName: venue.rows[0]?.name ?? null,
    events: r.rows,
  };
}

export default async function SignagePage({ params, searchParams }: PageProps): Promise<JSX.Element> {
  const { venueId } = await params;
  const { promoterId, theme } = await searchParams;
  const data = await fetchVenueAvail(venueId, promoterId);

  return (
    <SignageView
      venueName={data.venueName ?? 'Tixly'}
      events={data.events}
      theme={theme === 'dark' ? 'dark' : 'light'}
    />
  );
}
