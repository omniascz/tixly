import type {
  EventSeoData,
  EventForSeo,
  TicketTypeForSeo,
  ActiveEventListItem,
} from '@/types/seo.types'
import type { ThingsToDoEventInput } from '@/lib/seo-generator.js'
import {
  generateSlug,
  generateTitle,
  generateDescription,
  generateSchemaOrg,
  generateCanonicalUrl,
  calculateSitemapPriority,
} from '@/lib/seo-generator.js'

// ── DB adapter contract ───────────────────────────────────────────────────

export interface SeoDbAdapter {
  getEventForSeo(eventId: string): Promise<EventForSeo | null>
  getTicketTypesForSeo(eventId: string): Promise<TicketTypeForSeo[]>
  getAllActiveEvents(): Promise<ActiveEventListItem[]>
}

// ── Service ───────────────────────────────────────────────────────────────

export class SeoService {
  /**
   * Builds the full EventSeoData for a single event.
   * Fetches event + ticket types in parallel.
   */
  async generateEventSeo(
    eventId: string,
    baseUrl: string,
    db: SeoDbAdapter,
  ): Promise<EventSeoData> {
    const [event, tickets] = await Promise.all([
      db.getEventForSeo(eventId),
      db.getTicketTypesForSeo(eventId),
    ])

    if (!event) {
      throw new Error(`Event not found: ${eventId}`)
    }

    const slug = generateSlug(
      event.name,
      event.date.getFullYear(),
      event.venue.city,
    )
    const canonicalUrl = generateCanonicalUrl(baseUrl, slug)
    const title = generateTitle({
      name: event.name,
      date: event.date,
      city: event.venue.city,
    })

    const lowestPriceCents = tickets
      .filter((t) => t.available)
      .reduce(
        (min: number | null, t) =>
          min === null || t.price < min ? t.price : min,
        null,
      )

    const ticketPriceFrom =
      lowestPriceCents !== null
        ? Math.round(lowestPriceCents / 100)
        : null

    const description = generateDescription({
      name: event.name,
      date: event.date,
      venue: event.venue.name,
      city: event.venue.city,
      ticketPriceFrom,
      lineup: event.performers.map((p) => p.name),
    })

    const schemaOrg = generateSchemaOrg(event, tickets)

    const now = new Date()
    // TicketTypeForSeo does not carry sold/capacity counts; those come from
    // the event-level data.  Pass 0/0 so priority falls back to the date-based
    // branch (capacity === 0 means the sold-out branch is never triggered).
    const priority = calculateSitemapPriority(
      {
        status: event.status,
        date: event.date,
        ticketsSold: 0,
        capacity: 0,
      },
      now,
    )

    const daysUntilEvent =
      (event.date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    const changeFreq: EventSeoData['changeFreq'] =
      daysUntilEvent < 7 ? 'daily' : daysUntilEvent < 60 ? 'weekly' : 'monthly'

    const keywords = [
      event.name,
      event.venue.city,
      event.venue.name,
      'vstupenky',
      'tickets',
      ...event.performers.map((p) => p.name),
    ].filter((k): k is string => Boolean(k))

    const ogImage = event.images[0] ?? ''

    return {
      eventId: event.id,
      slug,
      canonicalUrl,
      title,
      description,
      keywords,
      ogTitle: title,
      ogDescription: description,
      ogImage,
      ogType: 'event',
      schemaOrg,
      lastModified: now,
      changeFreq,
      priority,
    }
  }

  /**
   * Generates a complete XML sitemap string for all active events.
   */
  async generateSitemap(baseUrl: string, db: SeoDbAdapter): Promise<string> {
    const events = await db.getAllActiveEvents()
    const now = new Date()

    const urlEntries = events
      .map((event) => {
        const loc = generateCanonicalUrl(baseUrl, event.slug)
        const lastmod = event.updatedAt.toISOString().split('T')[0]
        const priority = calculateSitemapPriority(
          {
            status: event.status,
            date: event.date,
            ticketsSold: event.ticketsSold,
            capacity: event.capacity,
          },
          now,
        )

        const daysUntilEvent =
          (event.date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        const changefreq =
          daysUntilEvent < 7
            ? 'daily'
            : daysUntilEvent < 60
              ? 'weekly'
              : 'monthly'

        return [
          '  <url>',
          `    <loc>${escapeXml(loc)}</loc>`,
          `    <lastmod>${lastmod}</lastmod>`,
          `    <changefreq>${changefreq}</changefreq>`,
          `    <priority>${priority.toFixed(1)}</priority>`,
          '  </url>',
        ].join('\n')
      })
      .join('\n')

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      urlEntries,
      '</urlset>',
    ].join('\n')
  }

  /**
   * Returns a static robots.txt string.
   */
  generateRobotsTxt(baseUrl: string): string {
    const base = baseUrl.replace(/\/+$/, '')
    return [
      'User-agent: *',
      'Allow: /',
      'Disallow: /api/',
      'Disallow: /admin/',
      'Disallow: /checkout/',
      '',
      `Sitemap: ${base}/sitemap.xml`,
    ].join('\n')
  }

  /**
   * Builds ThingsToDoEventInput for Google's "Things to do" rich result.
   * Returns null if the event is in the past (do not index past events).
   *
   * @param eventId Event ID to fetch
   * @param baseUrl Base URL for canonical event page
   * @param db Database adapter
   * @returns ThingsToDoEventInput or null if event not found or is in past
   */
  async buildThingsToDoData(
    eventId: string,
    baseUrl: string,
    db: SeoDbAdapter,
  ): Promise<ThingsToDoEventInput | null> {
    const [event, tickets] = await Promise.all([
      db.getEventForSeo(eventId),
      db.getTicketTypesForSeo(eventId),
    ])

    if (!event) {
      return null
    }

    // Do not index past events
    const now = new Date()
    if (event.date < now) {
      return null
    }

    const canonicalUrl = generateCanonicalUrl(baseUrl, eventId)

    // Map event status
    let status: ThingsToDoEventInput['status'] = 'EventScheduled'
    if (event.status === 'cancelled') {
      status = 'EventCancelled'
    } else if (event.status === 'postponed') {
      status = 'EventPostponed'
    }

    // Build offers, filtering out sold-out unless event is cancelled
    const offers: ThingsToDoEventInput['offers'] = tickets
      .filter(
        (t) =>
          t.available || event.status === 'cancelled',
      )
      .map((t) => ({
        name: t.name,
        priceHalire: Math.round(t.price),
        currency: event.currency,
        availability: !t.available
          ? 'SoldOut'
          : t.saleStart > now
            ? 'PreOrder'
            : 'InStock',
        validFrom: t.saleStart.toISOString(),
        url: t.url,
      }))

    // Map performers
    const performers =
      event.performers.length > 0
        ? event.performers.map((p) => ({
            name: p.name,
            type: (p.type === 'band' ? 'PerformingGroup' : 'Person') as const,
          }))
        : undefined

    return {
      id: event.id,
      name: event.name,
      description: event.description,
      startDate: event.date.toISOString(),
      endDate: event.endDate?.toISOString() ?? event.date.toISOString(),
      url: canonicalUrl,
      imageUrls: event.images,
      status,
      attendanceMode: 'OfflineEventAttendanceMode',
      location: {
        name: event.venue.name,
        streetAddress: event.venue.address,
        addressLocality: event.venue.city,
        postalCode: event.venue.postalCode,
        addressCountry: event.venue.country,
        latitude: event.venue.lat,
        longitude: event.venue.lng,
      },
      organizer: {
        name: event.organizer.name,
        url: event.organizer.url ?? canonicalUrl,
      },
      offers,
      performers,
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
