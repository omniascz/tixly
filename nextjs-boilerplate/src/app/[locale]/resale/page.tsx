import Link from 'next/link';
import { Pool } from 'pg';
import { pgPoolOptions } from '@/lib/db/pg-options';

export const dynamic = 'force-dynamic';

interface Listing {
  listingId: string;
  ticketId: string;
  askPriceHalire: number;
  originalPriceHalire: number;
  listedAt: string;
  expiresAt: string;
  event: {
    id: string;
    title: string;
    dateStart: string;
    venueName: string | null;
  };
  ticketTypeName: string;
  promoter: {
    name: string;
    slug: string | null;
    brandColorHex: string | null;
  } | null;
}

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool(pgPoolOptions(process.env.DATABASE_URL));
  return pool;
}

// Server-side query — žádný HTTP roundtrip na vlastní API (failoval pod RSC).
async function fetchMarketplace(): Promise<Listing[]> {
  try {
    const r = await db().query<{
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
    }>(
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
       WHERE l.status = 'active' AND l.expires_at > NOW() AND e.date_start > NOW()
       ORDER BY l.listed_at DESC
       LIMIT 50`,
    );
    return r.rows.map((row) => ({
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
    }));
  } catch (err) {
    console.error('[resale marketplace page]', err);
    return [];
  }
}

function fmtCzk(halire: number): string {
  return `${(halire / 100).toLocaleString('cs-CZ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} Kč`;
}

export default async function ResaleMarketplacePage() {
  const listings = await fetchMarketplace();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Resale marketplace</h1>
        <p className="text-sm text-muted-foreground">
          Lístky od ostatních fanoušků. Cena je shora omezena na face value (anti-scalping).
        </p>
      </div>

      {listings.length === 0 ? (
        <div className="rounded-md border bg-card p-6 text-center text-sm text-muted-foreground">
          Aktuálně nejsou v nabídce žádné resale lístky.
        </div>
      ) : (
        <ul className="space-y-3">
          {listings.map((l) => {
            const brandStripeColor =
              l.promoter?.brandColorHex && /^#[0-9a-f]{6}$/i.test(l.promoter.brandColorHex)
                ? l.promoter.brandColorHex
                : '#94a3b8';
            return (
            <li
              key={l.listingId}
              className="overflow-hidden rounded-md border bg-card hover:border-primary"
            >
              <div
                aria-hidden
                className="h-1.5"
                style={{ background: brandStripeColor }}
              />
              <div className="p-4">
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{l.event.title}</h2>
                    {l.promoter ? (
                      <p className="text-[11px] text-muted-foreground">
                        {l.promoter.slug ? (
                          <Link
                            href={`/cs/p/${l.promoter.slug}`}
                            className="hover:underline"
                          >
                            {l.promoter.name}
                          </Link>
                        ) : (
                          l.promoter.name
                        )}
                      </p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {new Date(l.event.dateStart).toLocaleString('cs-CZ', {
                        dateStyle: 'long',
                        timeStyle: 'short',
                      })}
                      {l.event.venueName ? ` · ${l.event.venueName}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {l.ticketTypeName}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold">{fmtCzk(l.askPriceHalire)}</div>
                    <div className="text-xs text-muted-foreground line-through">
                      {fmtCzk(l.originalPriceHalire)} face value
                    </div>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Link
                    href={`/cs/resale/${l.listingId}`}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                  >
                    Koupit
                  </Link>
                </div>
              </div>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
