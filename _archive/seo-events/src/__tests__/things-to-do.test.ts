import { describe, it, expect } from 'vitest'
import {
  generateThingsToDoJsonLd,
  type ThingsToDoEventInput,
} from '@/lib/seo-generator.js'

// ────────────────────────────────────────────────────────────────────────────
// Test Data Builders
// ────────────────────────────────────────────────────────────────────────────

function createMinimalEvent(): ThingsToDoEventInput {
  return {
    id: 'evt-123',
    name: 'Summer Festival 2026',
    description: 'A great summer festival',
    startDate: '2026-07-15T18:00:00+02:00',
    endDate: '2026-07-15T23:59:00+02:00',
    url: 'https://tixly.cz/akce/summer-festival-2026',
    imageUrls: ['https://example.com/image.jpg'],
    status: 'EventScheduled',
    attendanceMode: 'OfflineEventAttendanceMode',
    location: {
      name: 'Letná Park',
      streetAddress: 'Letenská 50',
      addressLocality: 'Praha',
      postalCode: '11000',
      addressCountry: 'CZ',
    },
    organizer: {
      name: 'Prague Events',
      url: 'https://praguevents.cz',
    },
    offers: [
      {
        name: 'Standard',
        priceHalire: 49000,
        currency: 'CZK',
        availability: 'InStock',
        validFrom: '2026-01-01T00:00:00Z',
        url: 'https://tixly.cz/checkout',
      },
    ],
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('generateThingsToDoJsonLd', () => {
  it('returns valid Schema.org Event with all required fields', () => {
    const event = createMinimalEvent()
    const result = generateThingsToDoJsonLd(event)

    expect(result['@context']).toBe('https://schema.org')
    expect(result['@type']).toBe('Event')
    expect(result['name']).toBe(event.name)
    expect(result['description']).toBe(event.description)
    expect(result['startDate']).toBe(event.startDate)
    expect(result['endDate']).toBe(event.endDate)
    expect(result['url']).toBe(event.url)
    expect(result['image']).toEqual(event.imageUrls)
    expect(result['eventStatus']).toBe('https://schema.org/EventScheduled')
    expect(result['eventAttendanceMode']).toBe(
      'https://schema.org/OfflineEventAttendanceMode',
    )
    expect(result['location']).toBeDefined()
    expect(result['organizer']).toBeDefined()
    expect(result['offers']).toBeDefined()
  })

  it('converts halíře to CZK with 2 decimal places', () => {
    const event = createMinimalEvent()
    event.offers = [
      {
        name: 'Standard',
        priceHalire: 49000,
        currency: 'CZK',
        availability: 'InStock',
        validFrom: '2026-01-01T00:00:00Z',
        url: 'https://tixly.cz/checkout',
      },
    ]

    const result = generateThingsToDoJsonLd(event)
    const offers = Array.isArray(result['offers'])
      ? result['offers']
      : [result['offers']]

    expect(offers[0]['price']).toBe('490.00')
  })

  it('converts priceHalire=0 correctly', () => {
    const event = createMinimalEvent()
    event.offers = [
      {
        name: 'Free',
        priceHalire: 0,
        currency: 'CZK',
        availability: 'InStock',
        validFrom: '2026-01-01T00:00:00Z',
        url: 'https://tixly.cz/checkout',
      },
    ]

    const result = generateThingsToDoJsonLd(event)
    const offers = Array.isArray(result['offers'])
      ? result['offers']
      : [result['offers']]

    expect(offers[0]['price']).toBe('0.00')
  })

  it('omits geo coordinates when lat/lng are missing', () => {
    const event = createMinimalEvent()
    const result = generateThingsToDoJsonLd(event)

    const location = result['location'] as Record<string, unknown>
    expect(location['geo']).toBeUndefined()
  })

  it('includes geo coordinates when both lat and lng are provided', () => {
    const event = createMinimalEvent()
    event.location.latitude = 50.0755
    event.location.longitude = 14.4378

    const result = generateThingsToDoJsonLd(event)
    const location = result['location'] as Record<string, unknown>

    expect(location['geo']).toBeDefined()
    const geo = location['geo'] as Record<string, unknown>
    expect(geo['@type']).toBe('GeoCoordinates')
    expect(geo['latitude']).toBe(50.0755)
    expect(geo['longitude']).toBe(14.4378)
  })

  it('omits geo when only latitude is provided', () => {
    const event = createMinimalEvent()
    event.location.latitude = 50.0755

    const result = generateThingsToDoJsonLd(event)
    const location = result['location'] as Record<string, unknown>
    expect(location['geo']).toBeUndefined()
  })

  it('omits geo when only longitude is provided', () => {
    const event = createMinimalEvent()
    event.location.longitude = 14.4378

    const result = generateThingsToDoJsonLd(event)
    const location = result['location'] as Record<string, unknown>
    expect(location['geo']).toBeUndefined()
  })

  it('maps cancelled event status correctly', () => {
    const event = createMinimalEvent()
    event.status = 'EventCancelled'

    const result = generateThingsToDoJsonLd(event)
    expect(result['eventStatus']).toBe('https://schema.org/EventCancelled')
  })

  it('maps postponed event status correctly', () => {
    const event = createMinimalEvent()
    event.status = 'EventPostponed'

    const result = generateThingsToDoJsonLd(event)
    expect(result['eventStatus']).toBe('https://schema.org/EventPostponed')
  })

  it('maps rescheduled event status correctly', () => {
    const event = createMinimalEvent()
    event.status = 'EventRescheduled'

    const result = generateThingsToDoJsonLd(event)
    expect(result['eventStatus']).toBe('https://schema.org/EventRescheduled')
  })

  it('preserves multiple offers in order', () => {
    const event = createMinimalEvent()
    event.offers = [
      {
        name: 'Early Bird',
        priceHalire: 39900,
        currency: 'CZK',
        availability: 'SoldOut',
        validFrom: '2026-01-01T00:00:00Z',
        url: 'https://tixly.cz/checkout',
      },
      {
        name: 'Regular',
        priceHalire: 49900,
        currency: 'CZK',
        availability: 'InStock',
        validFrom: '2026-03-01T00:00:00Z',
        url: 'https://tixly.cz/checkout',
      },
      {
        name: 'VIP',
        priceHalire: 99900,
        currency: 'CZK',
        availability: 'PreOrder',
        validFrom: '2026-02-01T00:00:00Z',
        url: 'https://tixly.cz/checkout',
      },
    ]

    const result = generateThingsToDoJsonLd(event)
    const offers = result['offers'] as Array<Record<string, unknown>>

    expect(offers.length).toBe(3)
    expect(offers[0]['name']).toBe('Early Bird')
    expect(offers[0]['price']).toBe('399.00')
    expect(offers[0]['availability']).toBe('https://schema.org/SoldOut')
    expect(offers[1]['name']).toBe('Regular')
    expect(offers[1]['price']).toBe('499.00')
    expect(offers[1]['availability']).toBe('https://schema.org/InStock')
    expect(offers[2]['name']).toBe('VIP')
    expect(offers[2]['price']).toBe('999.00')
    expect(offers[2]['availability']).toBe('https://schema.org/PreOrder')
  })

  it('omits performer key when no performers provided', () => {
    const event = createMinimalEvent()
    const result = generateThingsToDoJsonLd(event)

    expect(result['performer']).toBeUndefined()
  })

  it('includes performers with correct @type mapping', () => {
    const event = createMinimalEvent()
    event.performers = [
      { name: 'The Beatles', type: 'PerformingGroup' },
      { name: 'John Doe', type: 'Person' },
    ]

    const result = generateThingsToDoJsonLd(event)
    const performers = result['performer'] as Array<Record<string, unknown>>

    expect(performers.length).toBe(2)
    expect(performers[0]['@type']).toBe('PerformingGroup')
    expect(performers[0]['name']).toBe('The Beatles')
    expect(performers[1]['@type']).toBe('Person')
    expect(performers[1]['name']).toBe('John Doe')
  })

  it('omits keywords when no categories provided', () => {
    const event = createMinimalEvent()
    const result = generateThingsToDoJsonLd(event)

    expect(result['keywords']).toBeUndefined()
  })

  it('joins categories as comma-separated keywords', () => {
    const event = createMinimalEvent()
    event.categories = ['Concert', 'Music', 'Festival']

    const result = generateThingsToDoJsonLd(event)
    expect(result['keywords']).toBe('Concert, Music, Festival')
  })

  it('JSON stringifies without errors', () => {
    const event = createMinimalEvent()
    event.performers = [{ name: 'Artist A', type: 'Person' }]
    event.categories = ['Music', 'Concert']
    event.location.latitude = 50.0755
    event.location.longitude = 14.4378

    const result = generateThingsToDoJsonLd(event)

    // Should not throw
    const jsonString = JSON.stringify(result)
    expect(jsonString).toBeTruthy()

    // Should parse back without errors
    const parsed = JSON.parse(jsonString)
    expect(parsed['@context']).toBe('https://schema.org')
    expect(parsed['@type']).toBe('Event')
  })

  it('removes undefined fields from the output', () => {
    const event = createMinimalEvent()
    const result = generateThingsToDoJsonLd(event)

    // Check that no values are undefined
    const hasUndefinedValues = (obj: unknown): boolean => {
      if (obj === undefined) return true
      if (typeof obj !== 'object' || obj === null) return false

      for (const value of Object.values(obj)) {
        if (hasUndefinedValues(value)) return true
      }
      return false
    }

    expect(hasUndefinedValues(result)).toBe(false)
  })

  it('handles attendance mode variations', () => {
    const event = createMinimalEvent()
    event.attendanceMode = 'OnlineEventAttendanceMode'

    const result = generateThingsToDoJsonLd(event)
    expect(result['eventAttendanceMode']).toBe(
      'https://schema.org/OnlineEventAttendanceMode',
    )

    event.attendanceMode = 'MixedEventAttendanceMode'
    const result2 = generateThingsToDoJsonLd(event)
    expect(result2['eventAttendanceMode']).toBe(
      'https://schema.org/MixedEventAttendanceMode',
    )
  })

  it('builds valid PostalAddress in location', () => {
    const event = createMinimalEvent()
    const result = generateThingsToDoJsonLd(event)
    const location = result['location'] as Record<string, unknown>
    const address = location['address'] as Record<string, unknown>

    expect(address['@type']).toBe('PostalAddress')
    expect(address['streetAddress']).toBe(event.location.streetAddress)
    expect(address['addressLocality']).toBe(event.location.addressLocality)
    expect(address['postalCode']).toBe(event.location.postalCode)
    expect(address['addressCountry']).toBe(event.location.addressCountry)
  })

  it('includes organizer with url', () => {
    const event = createMinimalEvent()
    const result = generateThingsToDoJsonLd(event)
    const organizer = result['organizer'] as Record<string, unknown>

    expect(organizer['@type']).toBe('Organization')
    expect(organizer['name']).toBe(event.organizer.name)
    expect(organizer['url']).toBe(event.organizer.url)
  })

  it('handles empty offers array', () => {
    const event = createMinimalEvent()
    event.offers = []

    const result = generateThingsToDoJsonLd(event)
    expect(result['offers']).toEqual([])
  })
})
