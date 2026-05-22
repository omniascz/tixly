import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Pool } from 'pg';
import { ReportButton } from '@/components/public/ReportButton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/lib/format';
import { isValidLocale, DEFAULT_LOCALE } from '@/lib/i18n';
import { getDict } from '@/lib/i18n-dictionaries';
import { LotteryCard } from './LotteryCard';
import { Recommendations } from './Recommendations';
import { GroupInviteButton } from './GroupInviteButton';
import { ShareButtons } from './ShareButtons';
import { RestwertBalanceBadge } from './RestwertBalanceBadge';
import { RsvpButtons } from './RsvpButtons';
import {
  TicketPicker,
  type TicketAccess,
  type TicketTypeWithAccess,
} from './TicketPicker';

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
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const eventResult = await db.query<EventDetail>(
      `
      SELECT e.id, e.title, e.description, e.date_start, e.min_age, e.currency, e.queue_enabled,
             COALESCE(v.name, 'Online') AS venue_name,
             COALESCE(v.address, '') AS venue_address,
             e.promoter_id,
             p.name AS promoter_name,
             COALESCE(p.contact_email, p.email) AS promoter_contact_email,
             p.brand_color_hex AS promoter_brand_color_hex,
             p.brand_logo_url AS promoter_brand_logo_url,
             p.brand_tagline AS promoter_brand_tagline
      FROM catalog.events e
      LEFT JOIN catalog.venues v ON v.id = e.venue_id
      LEFT JOIN platform.promoters p ON p.id = e.promoter_id
      WHERE e.id = $1
    `,
      [id],
    );
    if (eventResult.rows.length === 0) return null;

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

export async function generateMetadata({
  params,
}: {
  params: { locale: string; id: string };
}): Promise<Metadata> {
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

export default async function EventDetailPage({
  params,
}: {
  params: { locale: string; id: string };
}) {
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
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
            {event.min_age && event.min_age > 0 ? (
              <span className="rounded-md bg-rose-100 px-2 py-1 text-xs font-bold text-rose-800">
                {event.min_age}+
              </span>
            ) : null}
          </div>
          <div className="mt-2 text-muted-foreground">
            {event.venue_name}
            {event.venue_address ? ` · ${event.venue_address}` : ''}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {formatDate(event.date_start, locale)}
          </div>
        </div>

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
            {ticketTypes.length === 0 ? (
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
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
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
