export interface SchemaOrgAddress {
  '@type': 'PostalAddress'
  streetAddress: string
  addressLocality: string
  addressRegion: string
  postalCode: string
  addressCountry: string  // ISO 3166-1 alpha-2 (CZ, SK, DE, AT, …)
}

export interface SchemaOrgPlace {
  '@type': 'Place'
  name: string
  address: SchemaOrgAddress
  geo?: {
    '@type': 'GeoCoordinates'
    latitude: number
    longitude: number
  }
}

export interface SchemaOrgOffer {
  '@type': 'Offer'
  name: string
  price: string
  priceCurrency: string  // ISO 4217 (CZK, EUR, USD, …)
  availability:
    | 'https://schema.org/InStock'
    | 'https://schema.org/SoldOut'
    | 'https://schema.org/PreOrder'
  validFrom: string
  url: string
}

export interface SchemaOrgOrganization {
  '@type': 'Organization'
  name: string
  url?: string
}

export interface SchemaOrgPerformer {
  '@type': 'Person' | 'MusicGroup'
  name: string
}

export interface SchemaOrgEvent {
  '@context': 'https://schema.org'
  '@type': 'Event'
  name: string
  startDate: string
  endDate: string | null
  description: string
  image: string[]
  location: SchemaOrgPlace
  offers: SchemaOrgOffer | SchemaOrgOffer[]
  organizer: SchemaOrgOrganization
  eventStatus:
    | 'https://schema.org/EventScheduled'
    | 'https://schema.org/EventCancelled'
    | 'https://schema.org/EventPostponed'
  eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode'
  performer?: SchemaOrgPerformer[]
}

export interface EventSeoData {
  eventId: string
  slug: string
  canonicalUrl: string

  title: string
  description: string
  keywords: string[]

  ogTitle: string
  ogDescription: string
  ogImage: string
  ogType: 'event'

  schemaOrg: SchemaOrgEvent

  lastModified: Date
  changeFreq: 'daily' | 'weekly' | 'monthly'
  priority: number
}

// ── Input types for the generator ──────────────────────────────────────────

export interface EventVenue {
  name: string
  address: string
  city: string
  region: string
  postalCode: string
  country: string  // ISO 3166-1 alpha-2, např. 'CZ', 'DE', 'AT'
  lat?: number
  lng?: number
}

export interface EventOrganizer {
  name: string
  url?: string
}

export interface EventPerformer {
  name: string
  type: 'person' | 'band'
}

export interface EventForSeo {
  id: string
  name: string
  description: string
  date: Date
  endDate: Date | null
  status: 'active' | 'cancelled' | 'postponed'
  timezone: string  // IANA timezone name, např. 'Europe/Prague', 'Europe/Berlin'
  currency: string  // ISO 4217 kód měny akce, např. 'CZK', 'EUR'
  venue: EventVenue
  organizer: EventOrganizer
  performers: EventPerformer[]
  images: string[]
}

export interface TicketTypeForSeo {
  name: string
  price: number
  saleStart: Date
  available: boolean
  url: string
}

export interface ActiveEventListItem {
  id: string
  slug: string
  updatedAt: Date
  date: Date
  ticketsSold: number
  capacity: number
  status: string
}
