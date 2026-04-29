export type EventCategory = string // 'concert' | 'festival' | 'theater' | 'sport' | 'conference' | 'other'

export interface EventMetrics {
  eventId: string
  organizerId: string
  category: EventCategory
  totalCapacity: number
  ticketsSold: number
  sellThroughRate: number          // ticketsSold / totalCapacity
  averageTicketPriceCzk: number
  pageViews: number
  conversionRate: number           // ticketsSold / pageViews (0 if pageViews=0)
  daysToSellOut: number | null     // null if not sold out
  daysBeforeEvent: number          // how many days before event the state was measured
  eventDate: Date
  measuredAt: Date
}

export interface BenchmarkPeer {
  category: EventCategory
  cityFilter: string | null
  capacityRange: { min: number; max: number }
  timeWindowDays: number           // compare events from last N days
}

export interface BenchmarkResult {
  targetEvent: EventMetrics
  peers: EventMetrics[]
  peerCount: number
  percentiles: {
    sellThroughRate: { p25: number; p50: number; p75: number; target: number; percentileRank: number }
    averageTicketPriceCzk: { p25: number; p50: number; p75: number; target: number; percentileRank: number }
    conversionRate: { p25: number; p50: number; p75: number; target: number; percentileRank: number }
  }
  insights: string[]               // generated textual insights
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>
  execute(sql: string, params?: unknown[]): Promise<void>
}

export interface ServiceDeps {
  db: DbAdapter
  now?: () => Date
}

export class BenchmarkingError extends Error {
  constructor(
    public readonly code: 'EVENT_NOT_FOUND' | 'INSUFFICIENT_PEERS' | 'METRICS_NOT_AVAILABLE',
    message: string
  ) {
    super(message)
    this.name = 'BenchmarkingError'
  }
}
