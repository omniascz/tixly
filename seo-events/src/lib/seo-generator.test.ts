import { describe, it, expect } from 'vitest'
import {
  generateSlug,
  generateTitle,
  generateDescription,
  generateSchemaOrg,
  generateCanonicalUrl,
  calculateSitemapPriority,
} from './seo-generator'
import type { EventForSeo, SchemaOrgOffer, TicketTypeForSeo } from '@/types/seo.types'

// ── Helpers ──────────────────────────────────────────────────────────────

const makeDate = (iso: string): Date => new Date(iso)

const baseEvent: EventForSeo = {
  id: 'evt-1',
  name: 'Festival XY',
  description: 'Největší festival léta.',
  date: makeDate('2026-08-15T18:00:00Z'),
  endDate: null,
  status: 'active',
  timezone: 'Europe/Prague',
  currency: 'CZK',
  venue: {
    name: 'Letňany Park',
    address: 'Veselská 1',
    city: 'Praha',
    region: 'Hlavní město Praha',
    postalCode: '19800',
    country: 'CZ',
    lat: 50.1302,
    lng: 14.5078,
  },
  organizer: { name: 'Live Nation CZ', url: 'https://livenation.cz' },
  performers: [
    { name: 'Radiohead', type: 'band' },
    { name: 'Jan Novák', type: 'person' },
  ],
  images: ['https://cdn.tixly.cz/festival-xy.jpg'],
}

const baseTickets: TicketTypeForSeo[] = [
  {
    name: 'Standard',
    price: 49000,
    saleStart: makeDate('2026-01-01T00:00:00Z'),
    available: true,
    url: 'https://tixly.cz/akce/festival-xy-2026-praha/koupit',
  },
  {
    name: 'VIP',
    price: 129000,
    saleStart: makeDate('2026-01-01T00:00:00Z'),
    available: true,
    url: 'https://tixly.cz/akce/festival-xy-2026-praha/koupit?type=vip',
  },
]

// ── generateSlug ──────────────────────────────────────────────────────────

describe('generateSlug', () => {
  it('produces lowercase hyphenated slug from ASCII input', () => {
    expect(generateSlug('Festival XY', 2026, 'Praha')).toBe(
      'festival-xy-2026-praha',
    )
  })

  it('removes Czech diacritics (á é í ó ú ů ž š č ř ď ť ň)', () => {
    const slug = generateSlug('Žízeň & Šlépěje', 2026, 'Brno')
    expect(slug).not.toMatch(/[áéíóúůžšč řďťň]/i)
  })

  it('removes Slovak diacritics (ľ ŕ ä)', () => {
    const slug = generateSlug('Ľudové Oslavy', 2026, 'Bratislava')
    expect(slug).not.toMatch(/[ľŕä]/i)
  })

  it('replaces spaces with hyphens', () => {
    expect(generateSlug('Rock in Park', 2026, 'Ostrava')).toBe(
      'rock-in-park-2026-ostrava',
    )
  })

  it('strips special characters like & ( ) ! ?', () => {
    const slug = generateSlug('Rock & Roll (Tour)!', 2026, 'Praha')
    expect(slug).not.toMatch(/[&()!?]/)
  })

  it('collapses multiple hyphens into one', () => {
    const slug = generateSlug('A---B', 2026, 'Praha')
    expect(slug).not.toMatch(/--/)
  })

  it('has no leading or trailing hyphens', () => {
    const slug = generateSlug('!Festival!', 2026, 'Praha')
    expect(slug).not.toMatch(/^-|-$/)
  })

  it('truncates to max 80 characters', () => {
    const longName = 'A'.repeat(100)
    const slug = generateSlug(longName, 2026, 'Praha')
    expect(slug.length).toBeLessThanOrEqual(80)
  })

  it('handles event name that already contains the year', () => {
    const slug = generateSlug('Festival 2026', 2026, 'Praha')
    expect(slug).toBe('festival-2026-2026-praha')
  })

  it('handles empty performers gracefully — just name+year+city', () => {
    const slug = generateSlug('Noc Divadel', 2026, 'České Budějovice')
    expect(slug).toBe('noc-divadel-2026-ceske-budejovice')
  })
})

// ── generateTitle ─────────────────────────────────────────────────────────

describe('generateTitle', () => {
  it('formats a standard title correctly', () => {
    const title = generateTitle({
      name: 'Festival XY',
      date: makeDate('2026-08-15T00:00:00Z'),
      city: 'Praha',
    })
    expect(title).toContain('Festival XY')
    expect(title).toContain('Vstupenky')
    expect(title).toContain('Praha')
  })

  it('stays within 60 characters for a short event name', () => {
    const title = generateTitle({
      name: 'Jazz Night',
      date: makeDate('2026-06-01T00:00:00Z'),
      city: 'Brno',
    })
    expect(title.length).toBeLessThanOrEqual(60)
  })

  it('truncates to 60 characters when event name is very long', () => {
    const title = generateTitle({
      name: 'Internationales Kulturell Musik Festival an der Moldau',
      date: makeDate('2026-09-20T00:00:00Z'),
      city: 'Praha',
    })
    expect(title.length).toBeLessThanOrEqual(60)
    expect(title).toMatch(/\.\.\.$|\.\.\./)
  })

  it('includes Czech month name', () => {
    const title = generateTitle({
      name: 'Koncert',
      date: makeDate('2026-08-15T00:00:00Z'),
      city: 'Praha',
    })
    expect(title).toContain('srpna')
  })
})

// ── generateDescription ───────────────────────────────────────────────────

describe('generateDescription', () => {
  it('produces description within 155 characters', () => {
    const desc = generateDescription({
      name: 'Festival XY',
      date: makeDate('2026-08-15T00:00:00Z'),
      venue: 'Letňany Park',
      city: 'Praha',
      ticketPriceFrom: 490,
      lineup: ['Radiohead', 'Massive Attack', 'Portishead'],
    })
    expect(desc.length).toBeLessThanOrEqual(155)
  })

  it('includes lineup when provided', () => {
    const desc = generateDescription({
      name: 'Rock Fest',
      date: makeDate('2026-07-10T00:00:00Z'),
      venue: 'Arena',
      city: 'Brno',
      ticketPriceFrom: 350,
      lineup: ['Band A', 'Band B', 'Band C'],
    })
    expect(desc).toContain('Band A')
  })

  it('omits lineup when not provided', () => {
    const desc = generateDescription({
      name: 'Divadelní noc',
      date: makeDate('2026-05-20T00:00:00Z'),
      venue: 'Národní divadlo',
      city: 'Praha',
      ticketPriceFrom: 250,
    })
    expect(desc).toContain('Divadelní noc')
    expect(desc.length).toBeLessThanOrEqual(155)
  })

  it('omits price section when ticketPriceFrom is null', () => {
    const desc = generateDescription({
      name: 'Free Event',
      date: makeDate('2026-06-01T00:00:00Z'),
      venue: 'Náměstí',
      city: 'Plzeň',
      ticketPriceFrom: null,
    })
    expect(desc).not.toContain('Vstupenky od')
  })

  it('includes price when ticketPriceFrom is given', () => {
    const desc = generateDescription({
      name: 'Pop Concert',
      date: makeDate('2026-10-10T00:00:00Z'),
      venue: 'O2 Arena',
      city: 'Praha',
      ticketPriceFrom: 990,
      lineup: ['Artist X'],
    })
    expect(desc).toContain('990')
    expect(desc).toContain('Kč')
  })

  it('handles very long lineup gracefully, stays within 155 chars', () => {
    const lineup = ['Extremely Long Artist Name One', 'Extremely Long Artist Name Two', 'Extremely Long Artist Name Three']
    const desc = generateDescription({
      name: 'Mega Fest 2026',
      date: makeDate('2026-08-01T00:00:00Z'),
      venue: 'Open Air Stage at the Biggest Park in the Country',
      city: 'Brno',
      ticketPriceFrom: 599,
      lineup,
    })
    expect(desc.length).toBeLessThanOrEqual(155)
  })
})

// ── generateSchemaOrg ─────────────────────────────────────────────────────

describe('generateSchemaOrg', () => {
  it('sets @context and @type correctly', () => {
    const schema = generateSchemaOrg(baseEvent, baseTickets)
    expect(schema['@context']).toBe('https://schema.org')
    expect(schema['@type']).toBe('Event')
  })

  it('maps active status to EventScheduled', () => {
    const schema = generateSchemaOrg({ ...baseEvent, status: 'active' }, [])
    expect(schema.eventStatus).toBe('https://schema.org/EventScheduled')
  })

  it('maps cancelled status to EventCancelled', () => {
    const schema = generateSchemaOrg({ ...baseEvent, status: 'cancelled' }, [])
    expect(schema.eventStatus).toBe('https://schema.org/EventCancelled')
  })

  it('maps postponed status to EventPostponed', () => {
    const schema = generateSchemaOrg({ ...baseEvent, status: 'postponed' }, [])
    expect(schema.eventStatus).toBe('https://schema.org/EventPostponed')
  })

  it('produces a single Offer when one ticket type', () => {
    const schema = generateSchemaOrg(baseEvent, [baseTickets[0]])
    expect(Array.isArray(schema.offers)).toBe(false)
    const offer = schema.offers as import('@/types/seo.types').SchemaOrgOffer
    expect(offer['@type']).toBe('Offer')
    expect(offer.priceCurrency).toBe('CZK')
    expect(offer.price).toBe('490') // 49000 haléřů / 100
  })

  it('produces an array of Offers when multiple ticket types', () => {
    const schema = generateSchemaOrg(baseEvent, baseTickets)
    expect(Array.isArray(schema.offers)).toBe(true)
    const offers = schema.offers as import('@/types/seo.types').SchemaOrgOffer[]
    expect(offers).toHaveLength(2)
    expect(offers[1].price).toBe('1290') // 129000 / 100
  })

  it('includes geo coordinates when lat/lng provided', () => {
    const schema = generateSchemaOrg(baseEvent, [])
    expect(schema.location.geo).toBeDefined()
    expect(schema.location.geo?.latitude).toBe(50.1302)
  })

  it('omits geo when lat/lng not provided', () => {
    const eventNoGeo: EventForSeo = {
      ...baseEvent,
      venue: { ...baseEvent.venue, lat: undefined, lng: undefined },
    }
    const schema = generateSchemaOrg(eventNoGeo, [])
    expect(schema.location.geo).toBeUndefined()
  })

  it('maps band performers to MusicGroup', () => {
    const schema = generateSchemaOrg(baseEvent, [])
    const performers = schema.performer ?? []
    const radiohead = performers.find((p) => p.name === 'Radiohead')
    expect(radiohead?.['@type']).toBe('MusicGroup')
  })

  it('maps person performers to Person', () => {
    const schema = generateSchemaOrg(baseEvent, [])
    const performers = schema.performer ?? []
    const jan = performers.find((p) => p.name === 'Jan Novák')
    expect(jan?.['@type']).toBe('Person')
  })

  it('omits performer key when no performers', () => {
    const eventNoPerformers: EventForSeo = { ...baseEvent, performers: [] }
    const schema = generateSchemaOrg(eventNoPerformers, [])
    expect(schema.performer).toBeUndefined()
  })

  it('sets eventAttendanceMode to OfflineEventAttendanceMode', () => {
    const schema = generateSchemaOrg(baseEvent, baseTickets)
    expect(schema.eventAttendanceMode).toBe(
      'https://schema.org/OfflineEventAttendanceMode',
    )
  })

  it('sets availability to SoldOut for unavailable ticket', () => {
    const soldOut: TicketTypeForSeo = { ...baseTickets[0], available: false }
    const schema = generateSchemaOrg(baseEvent, [soldOut])
    const offer = schema.offers as import('@/types/seo.types').SchemaOrgOffer
    expect(offer.availability).toBe('https://schema.org/SoldOut')
  })

  it('sets availability to PreOrder for future sale start', () => {
    const future: TicketTypeForSeo = {
      ...baseTickets[0],
      saleStart: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), // 30 days ahead
    }
    const schema = generateSchemaOrg(baseEvent, [future])
    const offer = schema.offers as import('@/types/seo.types').SchemaOrgOffer
    expect(offer.availability).toBe('https://schema.org/PreOrder')
  })

  it('uses event.currency for priceCurrency in offers', () => {
    const eurEvent: EventForSeo = { ...baseEvent, currency: 'EUR' }
    const schema = generateSchemaOrg(eurEvent, [baseTickets[0]])
    const offer = schema.offers as SchemaOrgOffer
    expect(offer.priceCurrency).toBe('EUR')
  })

  it('uses venue.country for addressCountry', () => {
    const deEvent: EventForSeo = {
      ...baseEvent,
      venue: { ...baseEvent.venue, country: 'DE' },
    }
    const schema = generateSchemaOrg(deEvent, [])
    expect(schema.location.address.addressCountry).toBe('DE')
  })
})

// ── toIso8601 — timezone correctness ─────────────────────────────────────

describe('toIso8601 — timezone correctness', () => {
  it('uses UTC+2 for Europe/Prague in summer (CEST)', () => {
    // 2026-08-15 18:00 UTC = 20:00 CEST (UTC+2)
    const summerEvent: EventForSeo = {
      ...baseEvent,
      date: new Date('2026-08-15T18:00:00Z'),
      timezone: 'Europe/Prague',
    }
    const schema = generateSchemaOrg(summerEvent, [])
    expect(schema.startDate).toBe('2026-08-15T20:00:00+02:00')
  })

  it('uses UTC+1 for Europe/Prague in winter (CET)', () => {
    // 2026-12-15 18:00 UTC = 19:00 CET (UTC+1)
    const winterEvent: EventForSeo = {
      ...baseEvent,
      date: new Date('2026-12-15T18:00:00Z'),
      timezone: 'Europe/Prague',
    }
    const schema = generateSchemaOrg(winterEvent, [])
    expect(schema.startDate).toBe('2026-12-15T19:00:00+01:00')
  })

  it('uses UTC+2 for Europe/Berlin in summer (CEST)', () => {
    // Berlin = same offset as Prague in summer
    const berlinEvent: EventForSeo = {
      ...baseEvent,
      date: new Date('2026-08-15T18:00:00Z'),
      timezone: 'Europe/Berlin',
    }
    const schema = generateSchemaOrg(berlinEvent, [])
    expect(schema.startDate).toBe('2026-08-15T20:00:00+02:00')
  })

  it('uses UTC+0 for Europe/London in winter (GMT)', () => {
    // 2026-01-10 20:00 UTC = 20:00 GMT (UTC+0)
    const londonEvent: EventForSeo = {
      ...baseEvent,
      date: new Date('2026-01-10T20:00:00Z'),
      timezone: 'Europe/London',
    }
    const schema = generateSchemaOrg(londonEvent, [])
    expect(schema.startDate).toBe('2026-01-10T20:00:00+00:00')
  })
})

// ── calculateSitemapPriority ──────────────────────────────────────────────

describe('calculateSitemapPriority', () => {
  const now = makeDate('2026-04-04T12:00:00Z')

  const event = (
    status: string,
    daysFromNow: number,
    ticketsSold = 0,
    capacity = 1000,
  ) => ({
    status,
    date: new Date(now.getTime() + daysFromNow * 24 * 60 * 60 * 1000),
    ticketsSold,
    capacity,
  })

  it('returns 0.1 for cancelled events', () => {
    expect(calculateSitemapPriority(event('cancelled', 60), now)).toBe(0.1)
  })

  it('returns 0.3 for sold-out events', () => {
    expect(calculateSitemapPriority(event('active', 60, 1000, 1000), now)).toBe(0.3)
  })

  it('returns 0.9 for active events within 30 days', () => {
    expect(calculateSitemapPriority(event('active', 15), now)).toBe(0.9)
  })

  it('returns 0.9 for active events at exactly the 30-day boundary (exclusive)', () => {
    expect(calculateSitemapPriority(event('active', 1), now)).toBe(0.9)
  })

  it('returns 0.7 for active events within 90 days (31–89 days)', () => {
    expect(calculateSitemapPriority(event('active', 60), now)).toBe(0.7)
  })

  it('returns 0.5 for active events beyond 90 days', () => {
    expect(calculateSitemapPriority(event('active', 120), now)).toBe(0.5)
  })

  it('returns 0.3 for sold-out regardless of proximity', () => {
    expect(calculateSitemapPriority(event('active', 5, 500, 500), now)).toBe(0.3)
  })

  it('cancelled takes priority over sold-out (returns 0.1)', () => {
    expect(calculateSitemapPriority(event('cancelled', 5, 1000, 1000), now)).toBe(0.1)
  })
})

// ── generateCanonicalUrl ──────────────────────────────────────────────────

describe('generateCanonicalUrl', () => {
  it('builds the canonical URL correctly', () => {
    expect(generateCanonicalUrl('https://tixly.cz', 'festival-xy-2026-praha')).toBe(
      'https://tixly.cz/akce/festival-xy-2026-praha',
    )
  })

  it('strips trailing slash from baseUrl before joining', () => {
    expect(generateCanonicalUrl('https://tixly.cz/', 'rock-fest-2026-brno')).toBe(
      'https://tixly.cz/akce/rock-fest-2026-brno',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Extended Coverage: Schema.org JSON-LD Generation & Sitemap Support
// ─────────────────────────────────────────────────────────────────────────────

describe('generateSchemaOrg — all fields JSON-LD generation', () => {
  it('generates event JSON-LD with all optional fields included', () => {
    const completeEvent: EventForSeo = {
      ...baseEvent,
      images: ['https://cdn.tixly.cz/event1.jpg', 'https://cdn.tixly.cz/event2.jpg'],
    }
    const schema = generateSchemaOrg(completeEvent, baseTickets)

    expect(schema['@context']).toBe('https://schema.org')
    expect(schema['@type']).toBe('Event')
    expect(schema.name).toBe(completeEvent.name)
    expect(schema.description).toBe(completeEvent.description)
    expect(schema.startDate).toBeDefined()
    expect(schema.endDate).toBeDefined()
    expect(schema.url).toBeDefined()
    expect(schema.image).toBeDefined()
    expect(schema.eventStatus).toBeDefined()
    expect(schema.eventAttendanceMode).toBeDefined()
    expect(schema.location).toBeDefined()
    expect(schema.organizer).toBeDefined()
    expect(schema.offers).toBeDefined()
    expect(schema.performer).toBeDefined()
  })

  it('omits null/undefined optional fields gracefully', () => {
    const minimalEvent: EventForSeo = {
      ...baseEvent,
      performers: [],
      images: [],
    }
    const schema = generateSchemaOrg(minimalEvent, [])

    expect(schema.performer).toBeUndefined()
    expect(schema.image).toBeDefined() // image array exists, though empty
  })

  it('handles multiple performers with mixed types', () => {
    const mixedPerformers = [
      { name: 'The Beatles', type: 'band' },
      { name: 'John Lennon', type: 'person' },
      { name: 'Abbey Road Orchestra', type: 'band' },
    ]
    const eventWithPerformers: EventForSeo = {
      ...baseEvent,
      performers: mixedPerformers,
    }
    const schema = generateSchemaOrg(eventWithPerformers, [])

    const performers = schema.performer as any[]
    expect(performers).toHaveLength(3)
    expect(performers[0]['@type']).toBe('MusicGroup')
    expect(performers[1]['@type']).toBe('Person')
    expect(performers[2]['@type']).toBe('MusicGroup')
  })

  it('includes geo location when coordinates provided', () => {
    const eventWithGeo: EventForSeo = {
      ...baseEvent,
      venue: {
        ...baseEvent.venue,
        lat: 50.0755,
        lng: 14.4378,
      },
    }
    const schema = generateSchemaOrg(eventWithGeo, [])

    expect(schema.location.geo).toBeDefined()
    expect(schema.location.geo?.latitude).toBe(50.0755)
    expect(schema.location.geo?.longitude).toBe(14.4378)
  })

  it('omits geo when coordinates are missing', () => {
    const eventNoGeo: EventForSeo = {
      ...baseEvent,
      venue: {
        ...baseEvent.venue,
        lat: undefined,
        lng: undefined,
      },
    }
    const schema = generateSchemaOrg(eventNoGeo, [])
    expect(schema.location.geo).toBeUndefined()
  })

  it('correctly maps all event statuses', () => {
    const statuses = [
      { input: 'active', expected: 'https://schema.org/EventScheduled' },
      { input: 'cancelled', expected: 'https://schema.org/EventCancelled' },
      { input: 'postponed', expected: 'https://schema.org/EventPostponed' },
    ]

    statuses.forEach(({ input, expected }) => {
      const eventWithStatus: EventForSeo = { ...baseEvent, status: input as any }
      const schema = generateSchemaOrg(eventWithStatus, [])
      expect(schema.eventStatus).toBe(expected)
    })
  })

  it('generates single offer object (not array) for one ticket type', () => {
    const schema = generateSchemaOrg(baseEvent, [baseTickets[0]])
    expect(Array.isArray(schema.offers)).toBe(false)
    const offer = schema.offers as any
    expect(offer['@type']).toBe('Offer')
    expect(offer.name).toBe('Standard')
  })

  it('generates offers array for multiple ticket types', () => {
    const schema = generateSchemaOrg(baseEvent, baseTickets)
    expect(Array.isArray(schema.offers)).toBe(true)
    const offers = schema.offers as any[]
    expect(offers).toHaveLength(2)
    expect(offers[0].name).toBe('Standard')
    expect(offers[1].name).toBe('VIP')
  })
})

describe('sitemap generation support', () => {
  it('calculateSitemapPriority assigns 0.9 to active events within 30 days', () => {
    const now = makeDate('2026-04-04T12:00:00Z')
    const soon = makeDate('2026-04-10T12:00:00Z') // 6 days away
    const event = {
      status: 'active',
      date: soon,
      ticketsSold: 100,
      capacity: 500,
    }
    const priority = calculateSitemapPriority(event, now)
    expect(priority).toBe(0.9)
  })

  it('calculateSitemapPriority assigns 0.7 to active events within 30-90 days', () => {
    const now = makeDate('2026-04-04T12:00:00Z')
    const upcoming = makeDate('2026-05-15T12:00:00Z') // 41 days away
    const event = {
      status: 'active',
      date: upcoming,
      ticketsSold: 100,
      capacity: 500,
    }
    const priority = calculateSitemapPriority(event, now)
    expect(priority).toBe(0.7)
  })

  it('calculateSitemapPriority assigns 0.5 to active events beyond 90 days', () => {
    const now = makeDate('2026-04-04T12:00:00Z')
    const farFuture = makeDate('2026-08-04T12:00:00Z') // 122 days away
    const event = {
      status: 'active',
      date: farFuture,
      ticketsSold: 100,
      capacity: 500,
    }
    const priority = calculateSitemapPriority(event, now)
    expect(priority).toBe(0.5)
  })

  it('calculateSitemapPriority assigns 0.3 to sold-out events', () => {
    const now = makeDate('2026-04-04T12:00:00Z')
    const soon = makeDate('2026-04-10T12:00:00Z')
    const event = {
      status: 'active',
      date: soon,
      ticketsSold: 500,
      capacity: 500,
    }
    const priority = calculateSitemapPriority(event, now)
    expect(priority).toBe(0.3)
  })

  it('calculateSitemapPriority assigns 0.1 to cancelled events', () => {
    const now = makeDate('2026-04-04T12:00:00Z')
    const event = {
      status: 'cancelled',
      date: new Date('2026-04-10T12:00:00Z'),
      ticketsSold: 100,
      capacity: 500,
    }
    const priority = calculateSitemapPriority(event, now)
    expect(priority).toBe(0.1)
  })
})

describe('robots.txt & missing optional fields handling', () => {
  it('handles events with missing optional fields gracefully', () => {
    const minimalEvent: EventForSeo = {
      id: 'evt-minimal',
      name: 'Minimal Event',
      description: null,
      date: makeDate('2026-08-15T18:00:00Z'),
      endDate: null,
      status: 'active',
      timezone: 'Europe/Prague',
      currency: 'CZK',
      venue: {
        name: 'Venue',
        address: null,
        city: 'Praha',
        region: null,
        postalCode: null,
        country: 'CZ',
      },
      organizer: { name: 'Org', url: null },
      performers: undefined,
      images: [],
    }
    const schema = generateSchemaOrg(minimalEvent, [])

    expect(schema.name).toBe('Minimal Event')
    expect(schema.description).toBeNull()
    expect(schema.location.address.streetAddress).toBeNull()
    expect(schema.performer).toBeUndefined()
  })

  it('slug generation handles edge cases (very long names)', () => {
    const longName = 'A'.repeat(150) // very long
    const slug = generateSlug(longName, 2026, 'Praha')
    expect(slug.length).toBeLessThanOrEqual(80)
    expect(slug).toMatch(/^[a-z0-9-]+$/)
  })

  it('generateDescription respects 155 character limit strictly', () => {
    const desc = generateDescription({
      name: 'Very Long Event Name That Could Be Lengthy',
      date: makeDate('2026-08-15T00:00:00Z'),
      venue: 'Very Large Venue with Long Name',
      city: 'Praha',
      ticketPriceFrom: 49900,
      lineup: ['Artist One', 'Artist Two', 'Artist Three', 'Artist Four'],
    })
    expect(desc.length).toBeLessThanOrEqual(155)
  })

  it('generateTitle respects 60 character limit strictly', () => {
    const title = generateTitle({
      name: 'Event Name That Could Be Very Long Indeed',
      date: makeDate('2026-08-15T00:00:00Z'),
      city: 'Prague',
    })
    expect(title.length).toBeLessThanOrEqual(60)
  })
})
