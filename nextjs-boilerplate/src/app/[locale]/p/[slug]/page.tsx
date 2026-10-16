/**
 * /cs/p/[slug] — public profil promotéra (sdílecí stránka divadla / klubu)
 *
 * Ukazuje branding (logo, barva, tagline) + list všech aktuálních published akcí.
 * Slug = `platform.promoters.slug`. URL ke sdílení na sociálních sítích
 * a embedu do vlastní stránky divadla.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Pool } from 'pg';
import { Card, CardContent } from '@/components/ui/card';
import { pgPoolOptions } from '@/lib/db/pg-options';
import { launchFeatureEnabled } from '@/lib/features/launch-flags';
import { formatDate } from '@/lib/format';
import { isValidLocale, DEFAULT_LOCALE } from '@/lib/i18n';
import { FollowButton } from './FollowButton';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

interface PromoterRow {
  id: string;
  name: string;
  slug: string;
  contact_email: string | null;
  brand_color_hex: string | null;
  brand_logo_url: string | null;
  brand_tagline: string | null;
}

interface EventRow {
  id: string;
  slug: string | null;
  title: string;
  date_start: string;
  category: string | null;
  venue_name: string | null;
  city: string | null;
  min_price: number | null;
  currency: string;
  cover_image: string | null;
}

interface PromoterStats {
  total_events: string;
  upcoming_events: string;
  past_events: string;
  avg_rating: number | null;
  review_count: string;
}

function shadeColor(hex: string, percent: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  const factor = 1 + percent / 100;
  r = Math.min(255, Math.max(0, Math.round(r * factor)));
  g = Math.min(255, Math.max(0, Math.round(g * factor)));
  b = Math.min(255, Math.max(0, Math.round(b * factor)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

async function fetchPromoter(slug: string): Promise<{
  promoter: PromoterRow;
  events: EventRow[];
  stats: PromoterStats;
} | null> {
  const db = new Pool(pgPoolOptions(process.env.DATABASE_URL));
  try {
    const pRes = await db.query<PromoterRow>(
      `SELECT id, name, slug, contact_email, brand_color_hex, brand_logo_url, brand_tagline
       FROM platform.promoters
       WHERE slug = $1 AND status = 'active'`,
      [slug],
    );
    if (pRes.rows.length === 0) return null;
    const promoter = pRes.rows[0];

    const [eRes, sRes] = await Promise.all([
      db.query<EventRow>(
        `SELECT e.id, e.slug, e.title, e.date_start, e.category, e.currency,
                e.cover_image_url AS cover_image,
                v.name AS venue_name, v.city,
                (SELECT MIN(base_price) FROM catalog.ticket_types WHERE event_id = e.id) AS min_price
         FROM catalog.events e
         LEFT JOIN catalog.venues v ON v.id = e.venue_id
         WHERE e.promoter_id = $1
           AND e.status = 'published'
           AND e.date_start > now() - interval '6 hours'
         ORDER BY e.date_start ASC
         LIMIT 50`,
        [promoter.id],
      ),
      db.query<PromoterStats>(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('published','finished'))::text AS total_events,
           COUNT(*) FILTER (WHERE status = 'published' AND date_start > now())::text AS upcoming_events,
           COUNT(*) FILTER (WHERE date_start < now())::text AS past_events,
           (SELECT AVG(rating)::numeric(3,2)
              FROM marketing.event_reviews er
              JOIN catalog.events e2 ON e2.id = er.event_id
              WHERE e2.promoter_id = $1 AND er.status = 'published') AS avg_rating,
           (SELECT COUNT(*)::text
              FROM marketing.event_reviews er
              JOIN catalog.events e2 ON e2.id = er.event_id
              WHERE e2.promoter_id = $1 AND er.status = 'published') AS review_count
         FROM catalog.events
         WHERE promoter_id = $1`,
        [promoter.id],
      ).catch(() => ({
        rows: [
          {
            total_events: '0',
            upcoming_events: '0',
            past_events: '0',
            avg_rating: null,
            review_count: '0',
          },
        ],
      })),
    ]);

    return {
      promoter,
      events: eRes.rows,
      stats: sRes.rows[0] ?? {
        total_events: '0',
        upcoming_events: '0',
        past_events: '0',
        avg_rating: null,
        review_count: '0',
      },
    };
  } finally {
    await db.end();
  }
}

export async function generateMetadata(
  props: {
    params: Promise<{ locale: string; slug: string }>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const data = await fetchPromoter(params.slug);
  if (!data) return { title: 'Tixly' };
  const title = `${data.promoter.name} — vstupenky online`;
  const description =
    data.promoter.brand_tagline ??
    `${data.promoter.name} — ${data.events.length} nadcházejících akcí`;
  return {
    title,
    description,
    alternates: { canonical: `${BASE_URL}/${params.locale}/p/${params.slug}` },
    openGraph: {
      title,
      description,
      siteName: 'Tixly',
      url: `${BASE_URL}/${params.locale}/p/${params.slug}`,
    },
  };
}

export const dynamic = 'force-dynamic';

const STRINGS = {
  cs: {
    upcoming: 'Nadcházející představení',
    none: 'Aktuálně žádná představení v prodeji. Sleduj nás na sociálních sítích pro novinky.',
    from: 'od',
    contact: 'Kontakt',
    subscriptions: '🎟️ Permanentky a předplatné',
    totalEvents: 'akcí celkem',
    upcomingShort: 'nadcházejících',
    rating: 'hodnocení',
    reviews: 'recenzí',
  },
  sk: {
    upcoming: 'Nadchádzajúce predstavenia',
    none: 'Aktuálne žiadne predstavenia v predaji. Sleduj nás na sociálnych sieťach.',
    from: 'od',
    contact: 'Kontakt',
    subscriptions: '🎟️ Permanentky a predplatné',
    totalEvents: 'akcií celkom',
    upcomingShort: 'nadchádzajúcich',
    rating: 'hodnotenie',
    reviews: 'recenzií',
  },
  en: {
    upcoming: 'Upcoming shows',
    none: 'No upcoming shows. Follow us for updates.',
    from: 'from',
    contact: 'Contact',
    subscriptions: '🎟️ Subscriptions & passes',
    totalEvents: 'events total',
    upcomingShort: 'upcoming',
    rating: 'rating',
    reviews: 'reviews',
  },
} as const;

export default async function PromoterPage(
  props: {
    params: Promise<{ locale: string; slug: string }>;
  }
) {
  const params = await props.params;
  const data = await fetchPromoter(params.slug);
  if (!data) {
    // /p/ je route pořadatele. Pokud slug odpovídá AKCI (starý/špatný odkaz,
    // záložka), přesměruj na detail akce místo tvrdého 404.
    const db = new Pool(pgPoolOptions(process.env.DATABASE_URL));
    let eventSlug: string | null = null;
    try {
      const r = await db.query<{ slug: string }>(
        `SELECT slug FROM catalog.events WHERE slug = $1 AND status = 'published' LIMIT 1`,
        [params.slug],
      );
      eventSlug = r.rows[0]?.slug ?? null;
    } finally {
      await db.end();
    }
    if (eventSlug) redirect(`/${params.locale}/events/${eventSlug}`);
    notFound();
  }
  const { promoter, events, stats } = data;
  const locale = isValidLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  const s = STRINGS[locale as keyof typeof STRINGS] ?? STRINGS.cs;

  const brandColor = promoter.brand_color_hex;
  const hue =
    [...promoter.id].reduce((s, c) => s + c.charCodeAt(0), 0) % 360;
  const heroStyle = brandColor
    ? { background: `linear-gradient(135deg, ${brandColor} 0%, ${shadeColor(brandColor, -25)} 100%)` }
    : { background: `linear-gradient(135deg, hsl(${hue}, 60%, 50%) 0%, hsl(${(hue + 60) % 360}, 70%, 40%) 100%)` };

  return (
    <div className="space-y-6">
      <div
        className="relative flex h-56 items-end overflow-hidden rounded-lg p-8 lg:h-72"
        style={heroStyle}
      >
        {promoter.brand_logo_url ? (
          <img
            src={promoter.brand_logo_url}
            alt={promoter.name}
            className="absolute right-6 top-6 h-14 w-auto rounded bg-white/90 p-1.5 shadow-sm lg:h-20"
          />
        ) : null}
        <div className="flex w-full items-end justify-between gap-4">
          <div className="space-y-2 text-white drop-shadow">
            <h1 className="text-3xl font-bold lg:text-4xl">{promoter.name}</h1>
            {promoter.brand_tagline ? (
              <p className="text-sm font-medium uppercase tracking-wider text-white/90 lg:text-base">
                {promoter.brand_tagline}
              </p>
            ) : null}
          </div>
          <FollowButton promoterId={promoter.id} promoterName={promoter.name} />
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="py-4 text-center">
            <div className="text-2xl font-bold">{stats.total_events}</div>
            <div className="text-xs text-muted-foreground">{s.totalEvents}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <div className="text-2xl font-bold text-emerald-700">{stats.upcoming_events}</div>
            <div className="text-xs text-muted-foreground">{s.upcomingShort}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <div className="text-2xl font-bold">
              {stats.avg_rating ? `★ ${Number(stats.avg_rating).toFixed(1)}` : '—'}
            </div>
            <div className="text-xs text-muted-foreground">{s.rating}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <div className="text-2xl font-bold">{stats.review_count}</div>
            <div className="text-xs text-muted-foreground">{s.reviews}</div>
          </CardContent>
        </Card>
      </div>

      <section>
        <h2 className="mb-3 text-xl font-semibold">
          {s.upcoming} ({events.length})
        </h2>
        {events.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              {s.none}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((ev) => (
              <Link
                key={ev.id}
                href={`/${locale}/events/${ev.slug ?? ev.id}`}
                className="group"
              >
                <Card className="h-full overflow-hidden transition-shadow hover:shadow-md">
                  <div
                    aria-hidden
                    className="h-24 bg-cover bg-center"
                    style={{
                      background: ev.cover_image
                        ? `url(${ev.cover_image}) center/cover`
                        : brandColor
                          ? `linear-gradient(135deg, ${brandColor} 0%, ${shadeColor(brandColor, -25)} 100%)`
                          : `linear-gradient(135deg, hsl(${hue}, 60%, 50%), hsl(${(hue + 60) % 360}, 70%, 40%))`,
                    }}
                  />
                  <CardContent className="space-y-1 pt-3">
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
                        {s.from}{' '}
                        {(ev.min_price / 100).toLocaleString(
                          locale === 'sk' ? 'sk-SK' : 'cs-CZ',
                        )}
                        {ev.currency === 'EUR' ? ' €' : ' Kč'}
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="rounded-md border bg-muted/30 p-3 text-sm">
        {/* Kolo 10 / krok 3: předplatné vypnuté přepínačem → odkaz skrytý */}
        {launchFeatureEnabled('subscriptions') ? (
        <Link
          href={`/${locale}/subscriptions?p=${promoter.slug}`}
          className="text-primary hover:underline"
        >
          {s.subscriptions}
        </Link>
        ) : null}
        {promoter.contact_email ? (
          <span className="ml-3 text-xs text-muted-foreground">
            {s.contact}:{' '}
            <a href={`mailto:${promoter.contact_email}`} className="text-primary hover:underline">
              {promoter.contact_email}
            </a>
          </span>
        ) : null}
      </div>
    </div>
  );
}
