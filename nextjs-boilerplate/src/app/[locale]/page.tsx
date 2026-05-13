import Link from 'next/link';
import { Pool } from 'pg';
import { Card, CardContent } from '@/components/ui/card';
import { isValidLocale, DEFAULT_LOCALE } from '@/lib/i18n';
import { formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface EventRow {
  id: string;
  title: string;
  date_start: string;
  venue_name: string | null;
  min_price: number | null;
  category: string | null;
  promoter_name: string | null;
  brand_color_hex: string | null;
}

interface PromoterRow {
  slug: string;
  name: string;
  brand_color_hex: string | null;
  brand_tagline: string | null;
  upcoming_count: string;
}

async function fetchLanding(): Promise<{ events: EventRow[]; promoters: PromoterRow[] }> {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const events = await db.query<EventRow>(
      `SELECT e.id, e.title, e.date_start, e.category,
              v.name AS venue_name,
              p.name AS promoter_name, p.brand_color_hex,
              (SELECT MIN(base_price) FROM catalog.ticket_types WHERE event_id = e.id AND visibility = 'public') AS min_price
       FROM catalog.events e
       LEFT JOIN catalog.venues v ON v.id = e.venue_id
       LEFT JOIN platform.promoters p ON p.id = e.promoter_id
       WHERE e.status = 'published'
         AND e.date_start > now()
       ORDER BY e.date_start ASC
       LIMIT 12`,
    );

    const promoters = await db.query<PromoterRow>(
      `SELECT p.slug, p.name, p.brand_color_hex, p.brand_tagline,
              (SELECT COUNT(*)::text FROM catalog.events
               WHERE promoter_id = p.id AND status = 'published' AND date_start > now()) AS upcoming_count
       FROM platform.promoters p
       WHERE p.status = 'active' AND p.slug IS NOT NULL
       ORDER BY (SELECT COUNT(*) FROM catalog.events
                 WHERE promoter_id = p.id AND status = 'published' AND date_start > now()) DESC
       LIMIT 6`,
    );
    return { events: events.rows, promoters: promoters.rows };
  } finally {
    await db.end();
  }
}

function shadeColor(hex: string | null, fallbackHue: number): string {
  if (hex && /^#[0-9a-f]{6}$/i.test(hex)) {
    return `linear-gradient(135deg, ${hex} 0%, ${hex}cc 100%)`;
  }
  return `linear-gradient(135deg, hsl(${fallbackHue}, 60%, 50%), hsl(${(fallbackHue + 60) % 360}, 70%, 40%))`;
}

export default async function LandingPage({ params }: { params: { locale: string } }) {
  const { events, promoters } = await fetchLanding();
  const locale = isValidLocale(params.locale) ? params.locale : DEFAULT_LOCALE;

  return (
    <div className="space-y-10">
      <section className="rounded-lg bg-gradient-to-br from-primary/10 via-background to-background p-10 text-center">
        <h1 className="text-4xl font-bold lg:text-5xl">Vstupenky, které prostě fungují</h1>
        <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
          Najdi divadlo, koncert nebo festival. Plať bezpečně, ulož si lístek do mobilu —
          ukážeš jen QR a jsi uvnitř.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href={`/${locale}/events`}
            className="inline-flex h-10 items-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Procházet akce
          </Link>
          <Link
            href={`/${locale}/search`}
            className="inline-flex h-10 items-center rounded-md border px-6 text-sm font-medium hover:bg-muted/40"
          >
            🔎 Hledat
          </Link>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-2xl font-semibold">Nadcházející akce</h2>
          <Link
            href={`/${locale}/events`}
            className="text-sm text-primary hover:underline"
          >
            Všechny akce →
          </Link>
        </div>
        {events.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              Aktuálně žádné akce v prodeji. Vrať se brzy.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((ev, i) => (
              <Link key={ev.id} href={`/${locale}/events/${ev.id}`} className="group">
                <Card className="h-full overflow-hidden transition-shadow hover:shadow-md">
                  <div
                    aria-hidden
                    className="h-24"
                    style={{ background: shadeColor(ev.brand_color_hex, (i * 47) % 360) }}
                  />
                  <CardContent className="space-y-1 pt-3">
                    <p className="text-xs text-muted-foreground">
                      {ev.promoter_name ?? '—'}
                    </p>
                    <h3 className="font-semibold leading-tight group-hover:underline">
                      {ev.title}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(ev.date_start, locale)}
                    </p>
                    {ev.venue_name ? (
                      <p className="text-xs text-muted-foreground">📍 {ev.venue_name}</p>
                    ) : null}
                    {ev.min_price !== null ? (
                      <p className="pt-1 text-sm font-medium">
                        od {(ev.min_price / 100).toLocaleString('cs-CZ')} Kč
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      {promoters.length > 0 ? (
        <section>
          <h2 className="mb-3 text-2xl font-semibold">Pořadatelé na Tixly</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {promoters.map((p, i) => (
              <Link key={p.slug} href={`/${locale}/p/${p.slug}`} className="group">
                <div
                  className="flex h-24 flex-col items-center justify-center rounded-md p-3 text-center text-white"
                  style={{ background: shadeColor(p.brand_color_hex, (i * 67) % 360) }}
                >
                  <p className="text-sm font-medium leading-tight">{p.name}</p>
                  {Number(p.upcoming_count) > 0 ? (
                    <p className="mt-1 text-[10px] opacity-80">
                      {p.upcoming_count} nadcházejících
                    </p>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border bg-muted/20 p-6 text-center">
        <h2 className="text-xl font-semibold">Jsi pořadatel?</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Vstupenky, statistiky, vstupní brána i pokladna v jednom. Bez měsíčních paušálů.
        </p>
        <Link
          href={`/${locale}/register-promoter`}
          className="mt-4 inline-flex h-10 items-center rounded-md border px-6 text-sm font-medium hover:bg-background"
        >
          Začít prodávat na Tixly →
        </Link>
      </section>
    </div>
  );
}
