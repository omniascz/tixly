import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Pool } from 'pg';
import { Co2TravelBadge } from '@/components/Co2TravelBadge';
import { ReportButton } from '@/components/public/ReportButton';
import { GtmHeadScript, GtmNoScript } from '@/components/tracking/GtmScript';
import { MetaPixel } from '@/components/tracking/MetaPixel';
import { PixelManager } from '@/components/tracking/PixelManager';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { pgPoolOptions } from '@/lib/db/pg-options';
import { formatDate } from '@/lib/format';
import { isValidLocale, DEFAULT_LOCALE } from '@/lib/i18n';
import { getDict } from '@/lib/i18n-dictionaries';
import { isSalesOpen } from '@/lib/sales/cutoff';
import { GroupInviteButton } from './GroupInviteButton';
import { LotteryCard } from './LotteryCard';
import { Recommendations } from './Recommendations';
import { RestwertBalanceBadge } from './RestwertBalanceBadge';
import { RsvpButtons } from './RsvpButtons';
import { ShareButtons } from './ShareButtons';
import { SuperfanSection } from './SuperfanSection';
import {
  TicketPicker,
  type TicketAccess,
  type TicketTypeWithAccess,
} from './TicketPicker';
import { TimedEntryWrapper } from './TimedEntryWrapper';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

// Posune hex barvu o `percent` (záporné = ztmavit, kladné = zesvětlit).
// Slouží jen pro hero gradient, ne pro přesnou barevnou shodu.
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

interface EventDetail {
  id: string;
  title: string;
  description: string | null;
  date_start: string;
  /** Kolo 7 (C-29): konec online prodeje; null = začátek akce. */
  sales_end_at?: string | null;
  timezone: string | null;
  venue_name: string;
  venue_address: string;
  min_age: number | null;
  currency: string;
  queue_enabled: boolean;
  promoter_id: string | null;
  promoter_name: string | null;
  promoter_contact_email: string | null;
  promoter_brand_color_hex: string | null;
  promoter_brand_logo_url: string | null;
  promoter_brand_tagline: string | null;
  promoter_meta_pixel_id: string | null;
  promoter_gtm_container_id: string | null;
  timed_entry_enabled: boolean;
  // Livestream
  event_type: string | null;
  streaming_url: string | null;
  streaming_provider: string | null;
  stream_replay_days: number;
  date_end: string | null;
  // Kolo 8: termín inscenace — údaje karty z catalog.productions, doplňky termínu
  production_id: string | null;
  production_subtitle: string | null;
  production_author: string | null;
  production_director: string | null;
  production_cast: Array<{ role: string; name: string }> | null;
  production_duration_min: number | null;
  production_intermission_min: number | null;
  production_age_rating: string | null;
  term_note: string | null;
  cast_alternation: string | null;
  venue_city: string | null;
}

interface TicketTypeRow {
  id: string;
  name: string;
  base_price: number;
  available: number;
  is_seated: boolean;
  visibility: 'public' | 'access_code' | 'hidden';
}

interface EventDay {
  id: string;
  label: string | null;
  starts_at: string;
}

interface EventZone {
  id: string;
  name: string;
  zone_type: string;
}

async function fetchDetail(id: string) {
  const db = new Pool(pgPoolOptions(process.env.DATABASE_URL));
  try {
    const eventResult = await db.query<EventDetail>(
      `
      SELECT e.id, e.title, e.description, e.date_start, e.date_end, e.sales_end_at, e.timezone, e.min_age, e.currency, e.queue_enabled,
             e.timed_entry_enabled,
             e.event_type,
             e.streaming_url, e.streaming_provider, e.stream_replay_days,
             COALESCE(v.name, 'Online') AS venue_name,
             COALESCE(v.address, '') AS venue_address,
             v.city AS venue_city,
             e.production_id, pr.subtitle AS production_subtitle, pr.author AS production_author,
             pr.director AS production_director, pr.cast_list AS production_cast,
             pr.duration_min AS production_duration_min, pr.intermission_min AS production_intermission_min,
             pr.age_rating AS production_age_rating, e.term_note, e.cast_alternation,
             e.promoter_id,
             p.name AS promoter_name,
             COALESCE(p.contact_email, p.email) AS promoter_contact_email,
             p.brand_color_hex AS promoter_brand_color_hex,
             p.brand_logo_url AS promoter_brand_logo_url,
             p.brand_tagline AS promoter_brand_tagline,
             p.meta_pixel_id AS promoter_meta_pixel_id,
             p.gtm_container_id AS promoter_gtm_container_id
      FROM catalog.events e
      LEFT JOIN catalog.venues v ON v.id = e.venue_id
      LEFT JOIN platform.promoters p ON p.id = e.promoter_id
      LEFT JOIN catalog.productions pr ON pr.id = e.production_id
      WHERE (e.id::text = $1 OR e.slug = $1)
    `,
      [id],
    );
    if (eventResult.rows.length === 0) return null;
    // [id] param může být UUID nebo slug (karty odkazují přes slug). Po resolvnutí
    // přepneme na reálné UUID, aby navazující dotazy (tickets/days/zones) seděly.
    id = eventResult.rows[0].id;

    // 'hidden' = úplně skrytý (nikdy nezobrazit)
    // 'access_code' = veřejně nezobrazit, ale klient může odemknout kódem
    // 'public' = vždy zobrazit
    const ticketsResult = await db.query<TicketTypeRow>(
      `SELECT id, name, base_price, remaining_qty AS available, is_seated, visibility
       FROM catalog.ticket_types
       WHERE event_id = $1
         AND visibility <> 'hidden'
       ORDER BY base_price ASC`,
      [id],
    );

    const accessResult = await db.query<{
      ticket_type_id: string;
      event_day_id: string | null;
      zone_id: string | null;
      access_level: string;
    }>(
      `SELECT tta.ticket_type_id, tta.event_day_id, tta.zone_id, tta.access_level
       FROM catalog.ticket_type_access tta
       JOIN catalog.ticket_types tt ON tt.id = tta.ticket_type_id
       WHERE tt.event_id = $1`,
      [id],
    );

    const daysResult = await db.query<EventDay>(
      `SELECT id, label, starts_at FROM catalog.event_days
       WHERE event_id = $1 ORDER BY day_index`,
      [id],
    );
    const zonesResult = await db.query<EventZone>(
      `SELECT id, name, zone_type FROM catalog.event_zones
       WHERE event_id = $1 ORDER BY display_order`,
      [id],
    );

    const accessByType = new Map<string, TicketAccess[]>();
    for (const row of accessResult.rows) {
      const list = accessByType.get(row.ticket_type_id) ?? [];
      list.push({
        event_day_id: row.event_day_id,
        zone_id: row.zone_id,
        access_level: row.access_level,
      });
      accessByType.set(row.ticket_type_id, list);
    }
    const ticketTypes: TicketTypeWithAccess[] = ticketsResult.rows.map((tt) => ({
      ...tt,
      access: accessByType.get(tt.id) ?? [],
      visibility: tt.visibility,
    }));

    return {
      event: eventResult.rows[0],
      ticketTypes,
      days: daysResult.rows,
      zones: zonesResult.rows,
    };
  } finally {
    await db.end();
  }
}

export const dynamic = 'force-dynamic';

export async function generateMetadata(
  props: {
    params: Promise<{ locale: string; id: string }>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const data = await fetchDetail(params.id);
  if (!data) return { title: 'Tixly — akce' };
  const { event } = data;
  const ogUrl = `${BASE_URL}/api/og/events/${event.id}`;
  const url = `${BASE_URL}/${params.locale}/events/${event.id}`;
  const description =
    event.description?.slice(0, 160) ??
    `${event.title} — ${event.venue_name}, ${formatDate(event.date_start, params.locale)}`;
  return {
    title: `${event.title} — Tixly`,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: event.title,
      description,
      url,
      siteName: 'Tixly',
      images: [{ url: ogUrl, width: 1200, height: 630, alt: event.title }],
      locale: params.locale,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: event.title,
      description,
      images: [ogUrl],
    },
  };
}

export default async function EventDetailPage(
  props: {
    params: Promise<{ locale: string; id: string }>;
  }
) {
  const params = await props.params;
  const data = await fetchDetail(params.id);
  if (!data) notFound();
  const { event, ticketTypes, days, zones } = data;
  const locale = isValidLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  const t = getDict(locale);

  // Branding: pokud promotér v `/admin/settings` vyplnil brand_color_hex, použij ho;
  // jinak fallback na hash hue z eventId (deterministický gradient bez obrázku).
  const brandColor = event.promoter_brand_color_hex;
  const hue =
    [...event.id].reduce((s, c) => s + c.charCodeAt(0), 0) % 360;
  const heroStyle = brandColor
    ? { background: `linear-gradient(135deg, ${brandColor} 0%, ${shadeColor(brandColor, -25)} 100%)` }
    : { background: `linear-gradient(135deg, hsl(${hue}, 60%, 50%) 0%, hsl(${(hue + 60) % 360}, 70%, 40%) 100%)` };

  // JSON-LD Event schema (schema.org)
  const minPrice = ticketTypes.reduce(
    (m, tt) => (tt.base_price < m ? tt.base_price : m),
    Number.POSITIVE_INFINITY,
  );
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    description: event.description ?? undefined,
    startDate: event.date_start,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place',
      name: event.venue_name,
      address: event.venue_address || undefined,
    },
    organizer: event.promoter_name
      ? { '@type': 'Organization', name: event.promoter_name }
      : undefined,
    image: `${BASE_URL}/api/og/events/${event.id}`,
    url: `${BASE_URL}/${locale}/events/${event.id}`,
    offers:
      Number.isFinite(minPrice) && ticketTypes.length > 0
        ? {
            '@type': 'AggregateOffer',
            lowPrice: (minPrice / 100).toFixed(2),
            priceCurrency: event.currency ?? 'CZK',
            availability: ticketTypes.some((tt) => tt.available > 0)
              ? 'https://schema.org/InStock'
              : 'https://schema.org/SoldOut',
            url: `${BASE_URL}/${locale}/events/${event.id}`,
          }
        : undefined,
  };

  return (
    <div className="space-y-6">
      <GtmHeadScript containerId={event.promoter_gtm_container_id ?? ''} />
      <GtmNoScript containerId={event.promoter_gtm_container_id ?? ''} />
      <MetaPixel
        pixelId={event.promoter_meta_pixel_id}
        event="ViewContent"
        eventData={{
          content_ids: [event.id],
          content_type: 'product',
          content_name: event.title,
          ...(Number.isFinite(minPrice) ? { value: minPrice / 100 } : {}),
          currency: event.currency ?? 'CZK',
        }}
      />
      <PixelManager
        eventId={event.id}
        pageEvent="ViewContent"
        eventData={{
          contentName: event.title,
          contentIds: [event.id],
          ...(Number.isFinite(minPrice) ? { value: minPrice / 100 } : {}),
          currency: event.currency ?? 'CZK',
        }}
      />
      <script
        type="application/ld+json"
        // SECURITY: JSON.stringify NEescapuje `</script>` ani `<`, takže promotér
        // s názvem/popisem akce obsahujícím `</script><script>…` by se vylomil z
        // LD+JSON bloku → stored XSS proti všem návštěvníkům. Escapujeme `<` na
        // `<` (a `>`/`&` pro jistotu) — JSON tím zůstane validní.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd)
            .replace(/</g, '\\u003c')
            .replace(/>/g, '\\u003e')
            .replace(/&/g, '\\u0026'),
        }}
      />
      <div
        className="relative flex h-48 items-end overflow-hidden rounded-lg p-6 lg:h-64"
        style={heroStyle}
      >
        {event.promoter_brand_logo_url ? (
          <img
            src={event.promoter_brand_logo_url}
            alt={event.promoter_name ?? ''}
            className="absolute right-6 top-6 h-12 w-auto rounded bg-white/90 p-1.5 shadow-sm lg:h-16"
          />
        ) : null}
        {event.promoter_brand_tagline ? (
          <div className="text-sm font-medium uppercase tracking-wider text-white/90 drop-shadow lg:text-base">
            {event.promoter_brand_tagline}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold">{event.title}</h1>
            {event.event_type === 'online' || event.event_type === 'hybrid' ? (
              <span className="rounded-md bg-blue-100 px-2 py-1 text-xs font-bold text-blue-800">
                {event.event_type === 'hybrid' ? 'Hybridní' : 'Online'}
              </span>
            ) : null}
            {event.min_age && event.min_age > 0 ? (
              <span className="rounded-md bg-rose-100 px-2 py-1 text-xs font-bold text-rose-800">
                {event.min_age}+
              </span>
            ) : null}
          </div>
          <div className="mt-2 text-muted-foreground">
            {event.event_type === 'online'
              ? 'Online přenos'
              : [event.venue_city, event.venue_name].filter(Boolean).join(' · ')}
            {event.venue_address && event.event_type !== 'online' ? ` · ${event.venue_address}` : ''}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {formatDate(event.date_start, locale)}
            {event.timezone && event.timezone !== 'Europe/Prague' && (
              <span className="ml-1 text-xs opacity-70">({event.timezone})</span>
            )}
          </div>
        </div>

        {event.streaming_url ? (
          <div className="rounded-md border border-blue-200 bg-blue-50 p-4">
            <div className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-600" aria-hidden="true">
                <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
              </svg>
              <span className="text-sm font-medium text-blue-900">Tato akce je dostupná jako online přenos</span>
            </div>
            <p className="mt-1 text-xs text-blue-700">
              Po zakoupení vstupenky získáte přístup ke sledování živého streamu.
              {event.stream_replay_days > 0
                ? ` Záznam bude k dispozici ${event.stream_replay_days} dní po skončení.`
                : ''}
            </p>
            {event.streaming_provider === 'youtube' && (
              <p className="mt-1 text-xs text-blue-600">Platforma: YouTube Live</p>
            )}
            {event.streaming_provider === 'vimeo' && (
              <p className="mt-1 text-xs text-blue-600">Platforma: Vimeo</p>
            )}
            {event.streaming_provider === 'zoom' && (
              <p className="mt-1 text-xs text-blue-600">Platforma: Zoom</p>
            )}
          </div>
        ) : null}

        {event.production_id ? (
          <div className="space-y-2 rounded-md border p-4 text-sm" data-testid="term-production-card">
            {event.production_subtitle ? <p className="text-base text-muted-foreground">{event.production_subtitle}</p> : null}
            <p className="text-muted-foreground">
              {[event.production_author ? `Autor: ${event.production_author}` : null,
                event.production_director ? `Režie: ${event.production_director}` : null,
                event.production_duration_min
                  ? `Délka ${event.production_duration_min} min${event.production_intermission_min ? ` (přestávka ${event.production_intermission_min} min)` : ''}`
                  : null,
                event.production_age_rating ? `Přístupnost ${event.production_age_rating}` : null].filter(Boolean).join(' · ')}
            </p>
            {event.term_note ? <p className="font-medium" data-testid="term-note">{event.term_note}</p> : null}
            {event.production_cast && event.production_cast.length > 0 ? (
              <p><span className="text-muted-foreground">Hrají: </span>{event.production_cast.map((c) => (c.role ? `${c.name} (${c.role})` : c.name)).join(', ')}</p>
            ) : null}
            {event.cast_alternation ? <p><span className="text-muted-foreground">Alternace v tomto termínu: </span>{event.cast_alternation}</p> : null}
            <a className="text-primary underline" href={`/${locale}/inscenace/${event.production_id}`}>Všechny termíny inscenace</a>
          </div>
        ) : null}

        {event.description && (
          <div className="prose prose-sm max-w-none">
            <p className="text-sm leading-relaxed whitespace-pre-line">
              {event.description}
            </p>
          </div>
        )}

        {event.promoter_name ? (
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="text-xs uppercase text-muted-foreground">{t.eventDetail.organizer}</div>
            <div className="font-medium">{event.promoter_name}</div>
            {event.promoter_contact_email ? (
              <a
                href={`mailto:${event.promoter_contact_email}`}
                className="text-xs text-primary hover:underline"
              >
                {event.promoter_contact_email}
              </a>
            ) : null}
          </div>
        ) : null}

        {days.length > 1 || zones.length > 1 ? (
          <div className="rounded-md border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">{t.eventDetail.eventProgram}</h3>
            {days.length > 1 ? (
              <div className="mb-3">
                <div className="text-xs uppercase text-muted-foreground">
                  {t.eventDetail.day} ({days.length})
                </div>
                <ul className="mt-1 space-y-1 text-sm">
                  {days.map((d) => (
                    <li key={d.id}>
                      <strong>{d.label ?? '—'}</strong>{' '}
                      <span className="text-muted-foreground">
                        ({formatDate(d.starts_at, locale)})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {zones.length > 1 ? (
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  {t.eventDetail.zone} ({zones.length})
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {zones.map((z) => (
                    <span
                      key={z.id}
                      className="rounded-full bg-slate-100 px-2 py-0.5 text-xs"
                    >
                      {z.name}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <RsvpButtons
          eventId={event.id}
          locale={(locale === 'sk' || locale === 'en' ? locale : 'cs') as 'cs' | 'sk' | 'en'}
        />

        <div className="space-y-3">
          <ShareButtons
            url={`/cs/events/${event.id}`}
            title={event.title}
          />
          <GroupInviteButton eventId={event.id} />
        </div>
      </div>
      <div>
        <Card>
          <CardHeader>
            <CardTitle>{t.eventDetail.tickets}</CardTitle>
          </CardHeader>
          <CardContent>
            {!isSalesOpen(event, 'online') ? (
              // Kolo 7 (C-29): po uzávěrce online prodeje se nákup nenabízí (server ho stejně odmítne).
              <p className="text-sm font-medium text-muted-foreground" data-testid="sales-closed">
                Prodej ukončen
              </p>
            ) : ticketTypes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t.eventDetail.noTicketsOnSale}
              </p>
            ) : (
              <>
                <LotteryCard
                  eventId={event.id}
                  ticketTypes={ticketTypes.map((tt) => ({ id: tt.id, name: tt.name }))}
                />
                {event.promoter_id ? (
                  <RestwertBalanceBadge
                    promoterId={event.promoter_id}
                    locale={
                      locale === 'sk' || locale === 'en' ? locale : 'cs'
                    }
                  />
                ) : null}
                {event.timed_entry_enabled ? (
                  <TimedEntryWrapper
                    eventId={event.id}
                    locale={locale}
                    currency={event.currency}
                    queueEnabled={event.queue_enabled}
                    ticketTypes={ticketTypes}
                    days={days}
                    zones={zones}
                    t={t.eventDetail}
                  />
                ) : (
                  <TicketPicker
                    eventId={event.id}
                    locale={locale}
                    currency={event.currency}
                    queueEnabled={event.queue_enabled}
                    ticketTypes={ticketTypes}
                    days={days}
                    zones={zones}
                    t={t.eventDetail}
                  />
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
      <div className="mx-auto mt-4 max-w-md px-4">
        <Co2TravelBadge eventId={event.id} />
      </div>
      <SuperfanSection eventId={event.id} />
      <Recommendations eventId={event.id} locale={locale} />

      <div className="mt-6 text-center">
        <ReportButton
          eventId={event.id}
          locale={(locale === 'sk' || locale === 'en' ? locale : 'cs') as 'cs' | 'sk' | 'en'}
        />
      </div>
    </div>
  );
}
