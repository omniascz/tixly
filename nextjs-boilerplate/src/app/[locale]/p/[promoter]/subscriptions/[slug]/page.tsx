import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Pool } from 'pg';

interface PackageRow {
  id: string;
  name: string;
  description: string | null;
  season_label: string;
  category: string;
  base_price_halire: number;
  early_bird_until: string | null;
  early_bird_price_halire: number | null;
  currency: string;
  sale_start: string;
  sale_end: string | null;
  capacity: number | null;
  status: string;
  holders_count: string;
  promoter_id: string;
  promoter_name: string;
  brand_color_hex: string | null;
  venue_name: string | null;
}

interface EventRow {
  id: string;
  title: string;
  slug: string | null;
  date_start: string;
  venue_name: string | null;
}

async function fetchPackage(
  promoterSlug: string,
  packageSlug: string,
): Promise<{ pkg: PackageRow; events: EventRow[] } | null> {
  if (!/^[a-z0-9-]{2,80}$/.test(promoterSlug)) return null;
  if (!/^[a-z0-9-]{2,80}$/.test(packageSlug)) return null;

  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const pkg = await db.query<PackageRow>(
      `SELECT pkg.id, pkg.name, pkg.description, pkg.season_label, pkg.category,
              pkg.base_price_halire,
              pkg.early_bird_until::text, pkg.early_bird_price_halire,
              pkg.currency, pkg.sale_start::text, pkg.sale_end::text,
              pkg.capacity, pkg.status,
              (SELECT COUNT(*)::text FROM subscriptions.holders
                 WHERE package_id = pkg.id AND status = 'active') AS holders_count,
              p.id AS promoter_id, p.name AS promoter_name, p.brand_color_hex,
              v.name AS venue_name
         FROM subscriptions.packages pkg
         JOIN platform.promoters p ON p.id = pkg.promoter_id
         LEFT JOIN catalog.venues v ON v.id = pkg.venue_id
        WHERE pkg.slug = $1 AND p.slug = $2 AND pkg.status IN ('on_sale', 'sold_out')`,
      [packageSlug, promoterSlug],
    );
    if (pkg.rows.length === 0) return null;

    const events = await db.query<EventRow>(
      `SELECT e.id, e.title, e.slug, e.date_start::text,
              v.name AS venue_name
         FROM subscriptions.package_events pe
         JOIN catalog.events e ON e.id = pe.event_id
         LEFT JOIN catalog.venues v ON v.id = e.venue_id
        WHERE pe.package_id = $1 AND e.status = 'published'
        ORDER BY pe.order_index ASC, e.date_start ASC`,
      [pkg.rows[0].id],
    );
    return { pkg: pkg.rows[0], events: events.rows };
  } catch {
    return null;
  } finally {
    await db.end();
  }
}

function formatPrice(halire: number, currency: string): string {
  const kc = halire / 100;
  const symbol = currency === 'EUR' ? '€' : 'Kč';
  return `${kc.toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} ${symbol}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('cs-CZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const CATEGORY_LABELS: Record<string, string> = {
  theater: 'Divadlo',
  concert_series: 'Koncertní cyklus',
  dance: 'Tanec',
  children: 'Pro děti',
  other: 'Ostatní',
};

export default async function SubscriptionLandingPage({
  params,
}: {
  params: Promise<{ locale: string; promoter: string; slug: string }>;
}) {
  const { locale, promoter, slug } = await params;
  const data = await fetchPackage(promoter, slug);
  if (!data) notFound();

  const { pkg, events } = data;
  const brand =
    pkg.brand_color_hex && /^#[0-9a-f]{6}$/i.test(pkg.brand_color_hex)
      ? pkg.brand_color_hex
      : '#10b981';

  const now = new Date();
  const earlyBirdActive =
    pkg.early_bird_until !== null &&
    pkg.early_bird_price_halire !== null &&
    new Date(pkg.early_bird_until) > now;
  const effectivePrice = earlyBirdActive
    ? pkg.early_bird_price_halire!
    : pkg.base_price_halire;
  const savings = earlyBirdActive
    ? pkg.base_price_halire - pkg.early_bird_price_halire!
    : 0;

  const isSoldOut = pkg.status === 'sold_out';
  const remaining = pkg.capacity ? pkg.capacity - Number(pkg.holders_count) : null;

  return (
    <div className="container mx-auto max-w-4xl px-4 py-10">
      <div className="mb-6">
        <Link
          href={`/${locale}/p/${promoter}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← {pkg.promoter_name}
        </Link>
      </div>

      <header
        className="rounded-lg p-8 text-white"
        style={{ background: `linear-gradient(135deg, ${brand} 0%, ${brand}dd 100%)` }}
      >
        <p className="text-sm font-medium uppercase tracking-wider opacity-90">
          {CATEGORY_LABELS[pkg.category] ?? pkg.category} · Sezóna {pkg.season_label}
        </p>
        <h1 className="mt-2 text-3xl font-bold lg:text-4xl">{pkg.name}</h1>
        {pkg.description ? (
          <p className="mt-3 max-w-2xl text-white/90">{pkg.description}</p>
        ) : null}
        <div className="mt-6 flex flex-wrap items-baseline gap-3">
          {earlyBirdActive ? (
            <>
              <span className="text-3xl font-bold">
                {formatPrice(effectivePrice, pkg.currency)}
              </span>
              <span className="text-base line-through opacity-70">
                {formatPrice(pkg.base_price_halire, pkg.currency)}
              </span>
              <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur">
                Early bird — ušetříš {formatPrice(savings, pkg.currency)}
              </span>
            </>
          ) : (
            <span className="text-3xl font-bold">
              {formatPrice(effectivePrice, pkg.currency)}
            </span>
          )}
        </div>
        {earlyBirdActive ? (
          <p className="mt-2 text-xs text-white/80">
            Sleva platí do {formatDate(pkg.early_bird_until!)}
          </p>
        ) : null}
      </header>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs uppercase text-muted-foreground">Představení</p>
          <p className="mt-1 text-2xl font-bold">{events.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs uppercase text-muted-foreground">Předplatitelů</p>
          <p className="mt-1 text-2xl font-bold">{pkg.holders_count}</p>
          {pkg.capacity ? (
            <p className="text-xs text-muted-foreground">z {pkg.capacity}</p>
          ) : null}
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs uppercase text-muted-foreground">Místo</p>
          <p className="mt-1 text-base font-semibold">{pkg.venue_name ?? '—'}</p>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="mb-4 text-xl font-semibold">Program ({events.length})</h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Program zatím není zveřejněn. Sledujte pořadatele pro update.
          </p>
        ) : (
          <ol className="space-y-3">
            {events.map((ev, i) => (
              <li
                key={ev.id}
                className="flex items-center gap-4 rounded-lg border bg-card p-4"
              >
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-full font-bold text-white"
                  style={{ background: brand }}
                  aria-hidden
                >
                  {i + 1}
                </span>
                <div className="flex-1">
                  <Link
                    href={`/${locale}/events/${ev.slug ?? ev.id}`}
                    className="font-medium hover:text-primary"
                  >
                    {ev.title}
                  </Link>
                  <div className="text-sm text-muted-foreground">
                    {formatDate(ev.date_start)}
                    {ev.venue_name ? ` · ${ev.venue_name}` : ''}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-8 rounded-lg border-2 border-dashed border-muted-foreground/30 p-6 text-center">
        {isSoldOut ? (
          <>
            <p className="text-base font-medium text-amber-700">Vyprodáno</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Všechny abonentky pro tuto sezónu jsou prodané. Sleduj pořadatele pro
              další sezónu.
            </p>
          </>
        ) : remaining !== null && remaining <= 5 ? (
          <>
            <p className="text-base font-medium">
              Posledních {remaining} {remaining === 1 ? 'kus' : 'kusů'}
            </p>
            <button
              type="button"
              className="mt-3 inline-flex items-center rounded-md px-6 py-2 text-sm font-medium text-white"
              style={{ background: brand }}
              disabled
              title="Buyer checkout flow — M2 milestone"
            >
              Koupit abonentku
            </button>
            <p className="mt-2 text-xs text-muted-foreground">
              Checkout flow se připravuje (M2 milestone).
            </p>
          </>
        ) : (
          <>
            <p className="text-base font-medium">Připoj se k abonentům</p>
            <button
              type="button"
              className="mt-3 inline-flex items-center rounded-md px-6 py-2 text-sm font-medium text-white"
              style={{ background: brand }}
              disabled
              title="Buyer checkout flow — M2 milestone"
            >
              Koupit abonentku
            </button>
            <p className="mt-2 text-xs text-muted-foreground">
              Checkout flow se připravuje (M2 milestone).
            </p>
          </>
        )}
      </section>
    </div>
  );
}
