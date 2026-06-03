import Link from 'next/link';
import { Pool } from 'pg';
import { Card, CardContent } from '@/components/ui/card';
import { formatDate } from '@/lib/format';
import { isValidLocale, DEFAULT_LOCALE } from '@/lib/i18n';
import { ForYouFeed } from '@/components/ForYouFeed';

export const dynamic = 'force-dynamic';

interface EventRow {
  id: string;
  title: string;
  slug: string | null;
  date_start: string;
  venue_name: string | null;
  city: string | null;
  min_price: number | null;
  currency: string | null;
  category: string | null;
  promoter_name: string | null;
  brand_color_hex: string | null;
  cover_image: string | null;
}

interface PromoterRow {
  slug: string;
  name: string;
  brand_color_hex: string | null;
  brand_tagline: string | null;
  upcoming_count: string;
}

interface CategoryRow {
  category: string;
  event_count: string;
}

const SELECT_EVENT_FIELDS = `e.id, e.title, e.slug, e.date_start, e.category, e.currency,
            e.cover_image_url AS cover_image,
            v.name AS venue_name, v.city,
            p.name AS promoter_name, p.brand_color_hex,
            (SELECT MIN(base_price) FROM catalog.ticket_types
             WHERE event_id = e.id AND visibility = 'public') AS min_price`;

interface FeaturedRow extends EventRow {
  editorial_blurb: string | null;
}

async function fetchLanding(): Promise<{
  events: EventRow[];
  thisWeek: EventRow[];
  featured: FeaturedRow[];
  promoters: PromoterRow[];
  categories: CategoryRow[];
}> {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const upcomingPromise = db.query<EventRow>(
      `SELECT ${SELECT_EVENT_FIELDS}
       FROM catalog.events e
       LEFT JOIN catalog.venues v ON v.id = e.venue_id
       LEFT JOIN platform.promoters p ON p.id = e.promoter_id
       WHERE e.status = 'published' AND e.date_start > now()
       ORDER BY e.date_start ASC
       LIMIT 12`,
    );

    const thisWeekPromise = db.query<EventRow>(
      `SELECT ${SELECT_EVENT_FIELDS}
       FROM catalog.events e
       LEFT JOIN catalog.venues v ON v.id = e.venue_id
       LEFT JOIN platform.promoters p ON p.id = e.promoter_id
       WHERE e.status = 'published'
         AND e.date_start BETWEEN now() AND now() + INTERVAL '7 days'
       ORDER BY e.date_start ASC
       LIMIT 6`,
    );

    const promotersPromise = db.query<PromoterRow>(
      `SELECT p.slug, p.name, p.brand_color_hex, p.brand_tagline,
              (SELECT COUNT(*)::text FROM catalog.events
               WHERE promoter_id = p.id AND status = 'published' AND date_start > now()) AS upcoming_count
       FROM platform.promoters p
       WHERE p.status = 'active' AND p.slug IS NOT NULL
       ORDER BY (SELECT COUNT(*) FROM catalog.events
                 WHERE promoter_id = p.id AND status = 'published' AND date_start > now()) DESC
       LIMIT 6`,
    );

    const featuredPromise = db.query<FeaturedRow>(
      `SELECT ${SELECT_EVENT_FIELDS}, e.editorial_blurb
       FROM catalog.events e
       LEFT JOIN catalog.venues v ON v.id = e.venue_id
       LEFT JOIN platform.promoters p ON p.id = e.promoter_id
       WHERE e.editorial_featured = true
         AND e.status = 'published'
         AND e.date_start > now()
         AND (e.editorial_until IS NULL OR e.editorial_until > now())
       ORDER BY e.editorial_order DESC, e.date_start ASC
       LIMIT 6`,
    );

    const categoriesPromise = db.query<CategoryRow>(
      `SELECT e.category, COUNT(*)::text AS event_count
       FROM catalog.events e
       WHERE e.status = 'published' AND e.date_start > now() AND e.category IS NOT NULL
       GROUP BY e.category
       ORDER BY COUNT(*) DESC
       LIMIT 8`,
    );

    const [events, thisWeek, featured, promoters, categories] = await Promise.all([
      upcomingPromise,
      thisWeekPromise,
      featuredPromise,
      promotersPromise,
      categoriesPromise,
    ]);

    return {
      events: events.rows,
      thisWeek: thisWeek.rows,
      featured: featured.rows,
      promoters: promoters.rows,
      categories: categories.rows,
    };
  } finally {
    await db.end();
  }
}

const CATEGORY_LABELS: Record<string, { cs: string; sk: string; en: string; icon: string }> = {
  concert: { cs: 'Koncerty', sk: 'Koncerty', en: 'Concerts', icon: '🎵' },
  theater: { cs: 'Divadlo', sk: 'Divadlo', en: 'Theater', icon: '🎭' },
  festival: { cs: 'Festivaly', sk: 'Festivaly', en: 'Festivals', icon: '🎪' },
  sport: { cs: 'Sport', sk: 'Šport', en: 'Sport', icon: '⚽' },
  comedy: { cs: 'Stand-up', sk: 'Stand-up', en: 'Comedy', icon: '🎤' },
  club: { cs: 'Kluby', sk: 'Kluby', en: 'Clubs', icon: '🪩' },
  conference: { cs: 'Konference', sk: 'Konferencie', en: 'Conferences', icon: '💼' },
  workshop: { cs: 'Workshopy', sk: 'Workshopy', en: 'Workshops', icon: '🛠' },
  exhibition: { cs: 'Výstavy', sk: 'Výstavy', en: 'Exhibitions', icon: '🖼' },
  cinema: { cs: 'Kino', sk: 'Kino', en: 'Cinema', icon: '🎬' },
};

function formatPrice(halire: number, currency: string | null, locale: string): string {
  const amount = (halire / 100).toLocaleString(locale === 'sk' ? 'sk-SK' : 'cs-CZ');
  const suffix = currency === 'EUR' ? ' €' : ' Kč';
  return amount + suffix;
}

function shadeColor(hex: string | null, fallbackHue: number): string {
  if (hex && /^#[0-9a-f]{6}$/i.test(hex)) {
    return `linear-gradient(135deg, ${hex} 0%, ${hex}cc 100%)`;
  }
  return `linear-gradient(135deg, hsl(${fallbackHue}, 60%, 50%), hsl(${(fallbackHue + 60) % 360}, 70%, 40%))`;
}

export default async function LandingPage({ params }: { params: { locale: string } }) {
  const { events, thisWeek, featured, promoters, categories } = await fetchLanding();
  const locale = isValidLocale(params.locale) ? params.locale : DEFAULT_LOCALE;

  return (
    <div className="space-y-10">
      <section className="rounded-lg bg-gradient-to-br from-primary/10 via-background to-background p-10 text-center">
        <h1 className="text-4xl font-bold lg:text-5xl">
          {locale === 'sk' ? 'Lístky, ktoré jednoducho fungujú' : locale === 'en' ? 'Tickets that just work' : 'Vstupenky, které prostě fungují'}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
          {locale === 'sk'
            ? 'Nájdi divadlo, koncert alebo festival. Plať bezpečne, ulož si lístok do mobilu — ukážeš QR a si vnútri.'
            : locale === 'en'
              ? 'Find theatre, concert or festival. Pay safely, save the ticket on your phone — just show the QR.'
              : 'Najdi divadlo, koncert nebo festival. Plať bezpečně, ulož si lístek do mobilu — ukážeš jen QR a jsi uvnitř.'}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href={`/${locale}/events`}
            className="inline-flex h-10 items-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {locale === 'sk' ? 'Prechádzať akcie' : locale === 'en' ? 'Browse events' : 'Procházet akce'}
          </Link>
          <Link
            href={`/${locale}/search`}
            className="inline-flex h-10 items-center rounded-md border px-6 text-sm font-medium hover:bg-muted/40"
          >
            🔎 {locale === 'en' ? 'Search' : locale === 'sk' ? 'Hľadať' : 'Hledat'}
          </Link>
        </div>
        <p className="mt-5 text-sm text-muted-foreground">
          {locale === 'sk' ? 'Organizuješ akcie? ' : locale === 'en' ? 'Run events? ' : 'Pořádáš akce? '}
          <Link href={`/${locale}/register-promoter`} className="font-medium text-primary underline-offset-4 hover:underline">
            {locale === 'sk' ? 'Predávaj s Tixly →' : locale === 'en' ? 'Sell with Tixly →' : 'Prodávej s Tixly →'}
          </Link>
        </p>
      </section>

      {/* Category quick-links */}
      {categories.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase text-muted-foreground">
            {locale === 'sk' ? 'Kategórie' : locale === 'en' ? 'Categories' : 'Kategorie'}
          </h2>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => {
              const meta = CATEGORY_LABELS[c.category] ?? {
                cs: c.category,
                sk: c.category,
                en: c.category,
                icon: '🎫',
              };
              const label =
                locale === 'sk' ? meta.sk : locale === 'en' ? meta.en : meta.cs;
              return (
                <Link
                  key={c.category}
                  href={`/${locale}/events?category=${encodeURIComponent(c.category)}`}
                  className="inline-flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm hover:bg-muted/40"
                >
                  <span aria-hidden>{meta.icon}</span>
                  <span>{label}</span>
                  <span className="text-xs text-muted-foreground">({c.event_count})</span>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Personalized "For you" feed — auth user dostane scored feed, anon trending */}
      <ForYouFeed
        locale={(locale === 'sk' || locale === 'en' ? locale : 'cs') as 'cs' | 'sk' | 'en'}
      />

      {/* Editorial "Tipy redakce" section — manuálně curated platform adminem */}
      {featured.length > 0 ? (
        <section
          aria-labelledby="featured-heading"
          className="rounded-lg border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent p-6"
        >
          <div className="mb-4 flex items-baseline justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-primary">
                {locale === 'sk' ? 'Tipy redakcie' : locale === 'en' ? 'Editor’s picks' : 'Tipy redakce'}
              </p>
              <h2 id="featured-heading" className="mt-1 text-2xl font-semibold">
                {locale === 'sk'
                  ? '⭐ Vybrané pre teba'
                  : locale === 'en'
                    ? '⭐ Hand-picked for you'
                    : '⭐ Vybráno pro tebe'}
              </h2>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((ev) => (
              <Link
                key={ev.id}
                href={`/${locale}/events/${ev.slug ?? ev.id}`}
                className="group block overflow-hidden rounded-lg border bg-card transition hover:shadow-lg"
              >
                <div
                  className="h-32 w-full"
                  style={{ background: shadeColor(ev.brand_color_hex, 200) }}
                >
                  {ev.cover_image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={ev.cover_image}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : null}
                </div>
                <div className="p-4">
                  <p className="text-xs uppercase text-muted-foreground">
                    {formatDate(ev.date_start)}
                  </p>
                  <h3 className="mt-1 text-base font-semibold leading-snug group-hover:text-primary">
                    {ev.title}
                  </h3>
                  {ev.editorial_blurb ? (
                    <p className="mt-2 text-sm italic text-muted-foreground">
                      „{ev.editorial_blurb}"
                    </p>
                  ) : ev.venue_name ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {ev.venue_name}
                      {ev.city ? `, ${ev.city}` : ''}
                    </p>
                  ) : null}
                  {ev.min_price !== null ? (
                    <p className="mt-2 text-sm font-medium text-primary">
                      {locale === 'en' ? 'from ' : 'od '}
                      {formatPrice(ev.min_price, ev.currency, locale)}
                    </p>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* This week section */}
      {thisWeek.length > 0 ? (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-2xl font-semibold">
              {locale === 'sk' ? '🔥 Tento týždeň' : locale === 'en' ? '🔥 This week' : '🔥 Tento týden'}
            </h2>
            <Link
              href={`/${locale}/events`}
              className="text-sm text-primary hover:underline"
            >
              {locale === 'en' ? 'All events' : locale === 'sk' ? 'Všetky akcie' : 'Všechny akce'} →
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {thisWeek.map((ev, i) => (
              <Link
                key={ev.id}
                href={`/${locale}/${ev.slug ? `p/${ev.slug}` : `events/${ev.id}`}`}
                className="group"
              >
                <Card className="h-full overflow-hidden transition-shadow hover:shadow-md">
                  <div
                    aria-hidden
                    className="relative h-32 bg-cover bg-center"
                    style={{
                      background: ev.cover_image
                        ? `url(${ev.cover_image}) center/cover`
                        : shadeColor(ev.brand_color_hex, (i * 47) % 360),
                    }}
                  >
                    <span className="absolute right-2 top-2 rounded-md bg-rose-600 px-2 py-0.5 text-xs font-medium text-white">
                      🔥 {locale === 'en' ? 'Soon' : 'Brzy'}
                    </span>
                  </div>
                  <CardContent className="space-y-1 pt-3">
                    <p className="text-xs text-muted-foreground">
                      {ev.promoter_name ?? '—'}
                    </p>
                    <h3 className="font-semibold leading-tight group-hover:underline">
                      {ev.title}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(ev.date_start, locale)}
                      {ev.city ? ` · ${ev.city}` : ''}
                    </p>
                    {ev.min_price !== null ? (
                      <p className="pt-1 text-sm font-medium">
                        {locale === 'en' ? 'from' : locale === 'sk' ? 'od' : 'od'}{' '}
                        {formatPrice(ev.min_price, ev.currency, locale)}
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-2xl font-semibold">
            {locale === 'sk' ? 'Nadchádzajúce akcie' : locale === 'en' ? 'Upcoming events' : 'Nadcházející akce'}
          </h2>
          <Link
            href={`/${locale}/events`}
            className="text-sm text-primary hover:underline"
          >
            {locale === 'en' ? 'All events' : locale === 'sk' ? 'Všetky akcie' : 'Všechny akce'} →
          </Link>
        </div>
        {events.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              {locale === 'sk'
                ? 'Aktuálne žiadne akcie v predaji. Vráť sa čoskoro.'
                : locale === 'en'
                  ? 'No events on sale. Check back soon.'
                  : 'Aktuálně žádné akce v prodeji. Vrať se brzy.'}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((ev, i) => (
              <Link
                key={ev.id}
                href={`/${locale}/${ev.slug ? `p/${ev.slug}` : `events/${ev.id}`}`}
                className="group"
              >
                <Card className="h-full overflow-hidden transition-shadow hover:shadow-md">
                  <div
                    aria-hidden
                    className="h-24 bg-cover bg-center"
                    style={{
                      background: ev.cover_image
                        ? `url(${ev.cover_image}) center/cover`
                        : shadeColor(ev.brand_color_hex, (i * 47) % 360),
                    }}
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
                      <p className="text-xs text-muted-foreground">
                        📍 {ev.venue_name}
                        {ev.city ? `, ${ev.city}` : ''}
                      </p>
                    ) : null}
                    {ev.min_price !== null ? (
                      <p className="pt-1 text-sm font-medium">
                        {locale === 'en' ? 'from' : 'od'}{' '}
                        {formatPrice(ev.min_price, ev.currency, locale)}
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
