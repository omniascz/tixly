/**
 * /cs/p/[slug] — public profil promotéra (sdílecí stránka divadla / klubu)
 *
 * Ukazuje branding (logo, barva, tagline) + list všech aktuálních published akcí.
 * Slug = `platform.promoters.slug`. URL ke sdílení na sociálních sítích
 * a embedu do vlastní stránky divadla.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Pool } from 'pg';
import { Card, CardContent } from '@/components/ui/card';
import { isValidLocale, DEFAULT_LOCALE } from '@/lib/i18n';
import { formatDate } from '@/lib/format';
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
  title: string;
  date_start: string;
  category: string | null;
  venue_name: string | null;
  min_price: number | null;
  currency: string;
}

function shadeColor(hex: string, percent: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const num = parseInt(m[1]!, 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  const factor = 1 + percent / 100;
  r = Math.min(255, Math.max(0, Math.round(r * factor)));
  g = Math.min(255, Math.max(0, Math.round(g * factor)));
  b = Math.min(255, Math.max(0, Math.round(b * factor)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

async function fetchPromoter(slug: string): Promise<{ promoter: PromoterRow; events: EventRow[] } | null> {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const pRes = await db.query<PromoterRow>(
      `SELECT id, name, slug, contact_email, brand_color_hex, brand_logo_url, brand_tagline
       FROM platform.promoters
       WHERE slug = $1 AND status = 'active'`,
      [slug],
    );
    if (pRes.rows.length === 0) return null;
    const promoter = pRes.rows[0]!;

    const eRes = await db.query<EventRow>(
      `SELECT e.id, e.title, e.date_start, e.category, e.currency,
              v.name AS venue_name,
              (SELECT MIN(base_price) FROM catalog.ticket_types WHERE event_id = e.id) AS min_price
       FROM catalog.events e
       LEFT JOIN catalog.venues v ON v.id = e.venue_id
       WHERE e.promoter_id = $1
         AND e.status = 'published'
         AND e.date_start > now() - interval '6 hours'
       ORDER BY e.date_start ASC
       LIMIT 50`,
      [promoter.id],
    );
    return { promoter, events: eRes.rows };
  } finally {
    await db.end();
  }
}

export async function generateMetadata({
  params,
}: {
  params: { locale: string; slug: string };
}): Promise<Metadata> {
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

export default async function PromoterPage({
  params,
}: {
  params: { locale: string; slug: string };
}) {
  const data = await fetchPromoter(params.slug);
  if (!data) notFound();
  const { promoter, events } = data;
  const locale = isValidLocale(params.locale) ? params.locale : DEFAULT_LOCALE;

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

      <section>
        <h2 className="mb-3 text-xl font-semibold">
          Nadcházející představení ({events.length})
        </h2>
        {events.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Aktuálně žádná představení v prodeji. Sleduj nás na sociálních sítích pro novinky.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((ev) => (
              <Link
                key={ev.id}
                href={`/${locale}/events/${ev.id}`}
                className="group"
              >
                <Card className="h-full overflow-hidden transition-shadow hover:shadow-md">
                  <div
                    aria-hidden
                    className="h-24"
                    style={{
                      background: brandColor
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

      <div className="rounded-md border bg-muted/30 p-3 text-sm">
        <Link
          href={`/${locale}/subscriptions?p=${promoter.slug}`}
          className="text-primary hover:underline"
        >
          🎟️ Permanentky a předplatné
        </Link>
        {promoter.contact_email ? (
          <span className="ml-3 text-xs text-muted-foreground">
            Kontakt:{' '}
            <a href={`mailto:${promoter.contact_email}`} className="text-primary hover:underline">
              {promoter.contact_email}
            </a>
          </span>
        ) : null}
      </div>
    </div>
  );
}
