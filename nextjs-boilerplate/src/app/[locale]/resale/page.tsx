import Link from 'next/link';

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

async function fetchMarketplace(): Promise<Listing[]> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const r = await fetch(`${base}/api/resale/marketplace`, { cache: 'no-store' });
  if (!r.ok) return [];
  const data = (await r.json()) as { listings: Listing[] };
  return data.listings;
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
