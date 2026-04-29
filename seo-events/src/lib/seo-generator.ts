import type {
  EventForSeo,
  TicketTypeForSeo,
  SchemaOrgEvent,
  SchemaOrgOffer,
  SchemaOrgPerformer,
} from '@/types/seo.types'

// ── Slug ──────────────────────────────────────────────────────────────────

/**
 * Removes Czech/Slovak diacritics via NFD decomposition, then strips combining
 * marks (Unicode category Mn), lowercases, and replaces non-alphanumeric runs
 * with a single hyphen.  Max 80 characters, no leading/trailing hyphens.
 */
export function generateSlug(
  eventName: string,
  year: number,
  city: string,
): string {
  const removeDiacritics = (s: string): string =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')

  const slugify = (s: string): string =>
    removeDiacritics(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')

  const parts = [slugify(eventName), String(year), slugify(city)]
    .filter(Boolean)
    .join('-')
    .replace(/-{2,}/g, '-')

  return parts.slice(0, 80)
}

// ── Title ─────────────────────────────────────────────────────────────────

const CZECH_MONTHS: Record<number, string> = {
  0: 'ledna',
  1: 'února',
  2: 'března',
  3: 'dubna',
  4: 'května',
  5: 'června',
  6: 'července',
  7: 'srpna',
  8: 'září',
  9: 'října',
  10: 'listopadu',
  11: 'prosince',
}

function formatCzechDate(date: Date): string {
  const day = date.getDate()
  const month = CZECH_MONTHS[date.getMonth()] ?? ''
  const year = date.getFullYear()
  return `${day}. ${month} ${year}`
}

/**
 * Produces: "Festival XY — Vstupenky | 15. srpna 2026, Praha"
 * Truncated to 60 characters with "..." if necessary.
 */
export function generateTitle(event: {
  name: string
  date: Date
  city: string
}): string {
  const dateStr = formatCzechDate(event.date)
  const full = `${event.name} — Vstupenky | ${dateStr}, ${event.city}`

  if (full.length <= 60) return full

  // Truncate the event name part so the total fits in 60 chars.
  // "..." = 3 chars; " — Vstupenky | {date}, {city}" = suffix
  const suffix = ` — Vstupenky | ${dateStr}, ${event.city}`
  const maxName = 60 - suffix.length - 3

  if (maxName <= 0) {
    return full.slice(0, 57) + '...'
  }

  return `${event.name.slice(0, maxName)}... — Vstupenky | ${dateStr}, ${event.city}`
}

// ── Description ───────────────────────────────────────────────────────────

/**
 * Generates a meta description up to 155 characters.
 * Pattern: "{Lineup} | {date}, {venue}, {city} | Vstupenky od {price} Kč"
 * Falls back to shorter variants when content doesn't fit.
 */
export function generateDescription(event: {
  name: string
  date: Date
  venue: string
  city: string
  ticketPriceFrom: number | null
  lineup?: string[]
}): string {
  const dateStr = formatCzechDate(event.date)
  const priceStr =
    event.ticketPriceFrom !== null
      ? ` | Vstupenky od ${event.ticketPriceFrom} Kč`
      : ''

  const buildDesc = (lineupStr: string): string => {
    const base = `${event.name}${lineupStr} | ${dateStr}, ${event.venue}, ${event.city}${priceStr}`
    return base
  }

  // Try with up to 3 performers
  if (event.lineup && event.lineup.length > 0) {
    const performers = event.lineup.slice(0, 3)
    let lineupStr = ` — ${performers.join(', ')}`
    let desc = buildDesc(lineupStr)

    if (desc.length <= 155) return desc

    // Try with fewer performers
    for (let n = performers.length - 1; n >= 1; n--) {
      lineupStr = ` — ${performers.slice(0, n).join(', ')}`
      desc = buildDesc(lineupStr)
      if (desc.length <= 155) return desc
    }
  }

  // No lineup
  let desc = buildDesc('')
  if (desc.length <= 155) return desc

  // Truncate hard
  return desc.slice(0, 152) + '...'
}

// ── Schema.org ────────────────────────────────────────────────────────────

function getTimezoneOffsetMinutes(date: Date, timezone: string): number {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' })
  const tzStr = date.toLocaleString('en-US', { timeZone: timezone })
  return (new Date(tzStr).getTime() - new Date(utcStr).getTime()) / 60_000
}

function toIso8601(date: Date, timezone: string): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  const offsetMinutes = getTimezoneOffsetMinutes(date, timezone)
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absOffset = Math.abs(offsetMinutes)
  const offsetH = Math.floor(absOffset / 60)
  const offsetM = absOffset % 60
  const offset = `${sign}${pad(offsetH)}:${pad(offsetM)}`
  const local = new Date(date.getTime() + offsetMinutes * 60_000)
  const y = local.getUTCFullYear()
  const mo = pad(local.getUTCMonth() + 1)
  const d = pad(local.getUTCDate())
  const h = pad(local.getUTCHours())
  const mi = pad(local.getUTCMinutes())
  const s = pad(local.getUTCSeconds())
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`
}

function mapEventStatus(
  status: EventForSeo['status'],
): SchemaOrgEvent['eventStatus'] {
  switch (status) {
    case 'active':
      return 'https://schema.org/EventScheduled'
    case 'cancelled':
      return 'https://schema.org/EventCancelled'
    case 'postponed':
      return 'https://schema.org/EventPostponed'
  }
}

function mapAvailability(
  ticket: TicketTypeForSeo,
  now: Date,
): SchemaOrgOffer['availability'] {
  if (!ticket.available) return 'https://schema.org/SoldOut'
  if (ticket.saleStart > now) return 'https://schema.org/PreOrder'
  return 'https://schema.org/InStock'
}

/**
 * Maps EventForSeo + TicketTypeForSeo[] to a valid Schema.org Event JSON-LD.
 * Prices are stored in haléře (integer), converted to CZK string (divided by 100).
 */
export function generateSchemaOrg(
  event: EventForSeo,
  tickets: TicketTypeForSeo[],
): SchemaOrgEvent {
  const now = new Date()

  // Offers
  let offers: SchemaOrgOffer | SchemaOrgOffer[]
  if (tickets.length === 0) {
    // Fallback single unavailable offer
    offers = {
      '@type': 'Offer',
      name: 'Vstupenka',
      price: '0',
      priceCurrency: event.currency,
      availability: 'https://schema.org/SoldOut',
      validFrom: toIso8601(now, event.timezone),
      url: generateCanonicalUrl('https://tixly.cz', ''),
    }
  } else if (tickets.length === 1) {
    const t = tickets[0]
    offers = {
      '@type': 'Offer',
      name: t.name,
      price: (t.price / 100).toFixed(0),
      priceCurrency: event.currency,
      availability: mapAvailability(t, now),
      validFrom: toIso8601(t.saleStart, event.timezone),
      url: t.url,
    }
  } else {
    offers = tickets.map(
      (t): SchemaOrgOffer => ({
        '@type': 'Offer',
        name: t.name,
        price: (t.price / 100).toFixed(0),
        priceCurrency: event.currency,
        availability: mapAvailability(t, now),
        validFrom: toIso8601(t.saleStart, event.timezone),
        url: t.url,
      }),
    )
  }

  // Performers
  const performer: SchemaOrgPerformer[] | undefined =
    event.performers.length > 0
      ? event.performers.map(
          (p): SchemaOrgPerformer => ({
            '@type': p.type === 'band' ? 'MusicGroup' : 'Person',
            name: p.name,
          }),
        )
      : undefined

  // Geo
  const geo =
    event.venue.lat !== undefined && event.venue.lng !== undefined
      ? {
          '@type': 'GeoCoordinates' as const,
          latitude: event.venue.lat,
          longitude: event.venue.lng,
        }
      : undefined

  const schema: SchemaOrgEvent = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.name,
    startDate: toIso8601(event.date, event.timezone),
    endDate: event.endDate ? toIso8601(event.endDate, event.timezone) : null,
    description: event.description,
    image: event.images,
    location: {
      '@type': 'Place',
      name: event.venue.name,
      address: {
        '@type': 'PostalAddress',
        streetAddress: event.venue.address,
        addressLocality: event.venue.city,
        addressRegion: event.venue.region,
        postalCode: event.venue.postalCode,
        addressCountry: event.venue.country,
      },
      ...(geo ? { geo } : {}),
    },
    offers,
    organizer: {
      '@type': 'Organization',
      name: event.organizer.name,
      ...(event.organizer.url ? { url: event.organizer.url } : {}),
    },
    eventStatus: mapEventStatus(event.status),
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    ...(performer ? { performer } : {}),
  }

  return schema
}

// ── Canonical URL ─────────────────────────────────────────────────────────

export function generateCanonicalUrl(baseUrl: string, slug: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  return `${base}/akce/${slug}`
}

// ── Things to do ─────────────────────────────────────────────────────────

/**
 * Input type for generating Google's "Things to do" rich result structured data.
 * Maps to Schema.org Event with Google-specific requirements.
 *
 * @see https://developers.google.com/search/docs/appearance/structured-data/event
 * @see https://developers.google.com/things-to-do
 */
export interface ThingsToDoEventInput {
  id: string
  name: string
  description: string
  startDate: string // ISO datetime
  endDate: string // ISO datetime
  url: string // canonical event page
  imageUrls: string[] // 1-3 images, 16:9 preferred
  /** EventStatus enum: scheduled / cancelled / postponed / rescheduled */
  status:
    | 'EventScheduled'
    | 'EventCancelled'
    | 'EventPostponed'
    | 'EventRescheduled'
  /** Online/offline/mixed mode */
  attendanceMode:
    | 'OfflineEventAttendanceMode'
    | 'OnlineEventAttendanceMode'
    | 'MixedEventAttendanceMode'
  location: {
    name: string
    streetAddress: string
    addressLocality: string
    postalCode: string
    addressCountry: string // ISO 3166-1 alpha-2, e.g. "CZ"
    latitude?: number
    longitude?: number
  }
  organizer: {
    name: string
    url: string
  }
  offers: Array<{
    name: string // e.g. "Standard", "VIP"
    priceHalire: number // INTEGER halíře
    currency: string // "CZK"
    availability: 'InStock' | 'SoldOut' | 'PreOrder'
    validFrom: string // ISO datetime when sales start
    url: string // direct purchase URL
  }>
  performers?: Array<{ name: string; type: 'Person' | 'PerformingGroup' }>
  /** Event categories from Google's controlled vocabulary, e.g. ["Concert", "Music"] */
  categories?: string[]
}

/**
 * Generates Schema.org Event JSON-LD for Google's "Things to do" rich result.
 * Ensures prices are converted from halíře (integer) to CZK (decimal string).
 * Strips undefined keys from output.
 *
 * @param event Input event data
 * @returns Valid Schema.org Event object suitable for Google indexing
 *
 * @see https://developers.google.com/search/docs/appearance/structured-data/event
 */
export function generateThingsToDoJsonLd(
  event: ThingsToDoEventInput,
): Record<string, unknown> {
  // Helper to remove undefined values from object
  const stripUndefined = (obj: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(obj).filter(([, v]) => v !== undefined),
    )

  // Build location with optional geo
  const geo =
    event.location.latitude !== undefined &&
    event.location.longitude !== undefined
      ? {
          '@type': 'GeoCoordinates',
          latitude: event.location.latitude,
          longitude: event.location.longitude,
        }
      : undefined

  const location = stripUndefined({
    '@type': 'Place',
    name: event.location.name,
    address: {
      '@type': 'PostalAddress',
      streetAddress: event.location.streetAddress,
      addressLocality: event.location.addressLocality,
      postalCode: event.location.postalCode,
      addressCountry: event.location.addressCountry,
    },
    geo,
  })

  // Map offers: convert halíře to CZK as string
  const offers = event.offers.map((o) => ({
    '@type': 'Offer',
    name: o.name,
    price: (o.priceHalire / 100).toFixed(2),
    priceCurrency: o.currency,
    availability: `https://schema.org/${o.availability}`,
    validFrom: o.validFrom,
    url: o.url,
  }))

  // Map performers
  const performers =
    event.performers && event.performers.length > 0
      ? event.performers.map((p) => ({
          '@type': p.type,
          name: p.name,
        }))
      : undefined

  // Keywords from categories
  const keywords =
    event.categories && event.categories.length > 0
      ? event.categories.join(', ')
      : undefined

  // Build final schema with no undefined fields
  const schema = stripUndefined({
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.name,
    description: event.description,
    image: event.imageUrls,
    startDate: event.startDate,
    endDate: event.endDate,
    eventStatus: `https://schema.org/${event.status}`,
    eventAttendanceMode: `https://schema.org/${event.attendanceMode}`,
    location,
    organizer: {
      '@type': 'Organization',
      name: event.organizer.name,
      url: event.organizer.url,
    },
    offers,
    performer: performers,
    keywords,
    url: event.url,
  })

  return schema
}

// ── Sitemap priority ──────────────────────────────────────────────────────

/**
 * Returns a sitemap priority score based on event status, proximity, and
 * sell-out status.
 *
 * Rules (applied in order, first match wins):
 *  - cancelled → 0.1
 *  - sold out (available === 0%) → 0.3
 *  - active, within 30 days → 0.9
 *  - active, within 90 days → 0.7
 *  - active, further away → 0.5
 */
export function calculateSitemapPriority(
  event: {
    status: string
    date: Date
    ticketsSold: number
    capacity: number
  },
  now: Date,
): number {
  if (event.status === 'cancelled') return 0.1

  const soldOut =
    event.capacity > 0 && event.ticketsSold >= event.capacity

  if (soldOut) return 0.3

  const msPerDay = 1000 * 60 * 60 * 24
  const daysUntilEvent = (event.date.getTime() - now.getTime()) / msPerDay

  if (daysUntilEvent < 30) return 0.9
  if (daysUntilEvent < 90) return 0.7
  return 0.5
}
