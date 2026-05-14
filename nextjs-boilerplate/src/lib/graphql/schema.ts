/**
 * GraphQL schema definition (SDL) pro Tixly public API.
 *
 * Read-only — write operations probíhají přes existing REST endpoints
 * s auth/idempotency requirements.
 *
 * Použití: dynamic import `graphql` package v route handleru,
 * `buildSchema` + `graphql.execute`.
 */

export const SCHEMA_SDL = `
  scalar DateTime
  scalar UUID

  type Query {
    "Single event by ID nebo slug"
    event(id: UUID, slug: String): Event

    "List published events. Default ordering: date_start ASC."
    events(
      limit: Int = 20
      offset: Int = 0
      city: String
      eventType: String
      promoterId: UUID
      promoterSlug: String
      dateFrom: DateTime
      dateTo: DateTime
    ): EventConnection!

    "Single promotér profile."
    promoter(slug: String!): Promoter

    "Search events by full-text query."
    searchEvents(query: String!, limit: Int = 20): [Event!]!

    "Trending events (highest sales velocity last 7 days)."
    trending(limit: Int = 10): [Event!]!
  }

  type EventConnection {
    nodes: [Event!]!
    total: Int!
    hasMore: Boolean!
  }

  type Event {
    id: UUID!
    slug: String
    title: String!
    description: String
    coverImage: String
    eventType: String
    status: String!
    dateStart: DateTime!
    dateEnd: DateTime
    minAge: Int
    currency: String!
    venue: Venue
    promoter: Promoter
    ticketTypes: [TicketType!]!
    cheapestPriceHalire: Int
    soldOut: Boolean!
  }

  type Venue {
    id: UUID!
    name: String!
    city: String
    address: String
    capacity: Int
    latitude: Float
    longitude: Float
  }

  type Promoter {
    id: UUID!
    slug: String!
    name: String!
    brandColorHex: String
    brandLogoUrl: String
    upcomingEvents(limit: Int = 20): [Event!]!
  }

  type TicketType {
    id: UUID!
    name: String!
    kind: String!
    basePrice: Int!
    remainingQty: Int!
    totalQty: Int!
    zone: String
    isSeated: Boolean!
    requiresPersonalization: Boolean!
    discountKind: String
    verificationHint: String
  }
`;
