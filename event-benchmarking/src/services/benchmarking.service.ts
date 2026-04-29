import {
  EventMetrics,
  BenchmarkPeer,
  BenchmarkResult,
  ServiceDeps,
  BenchmarkingError,
} from '../types/benchmarking.types'
import { calculatePercentile, getPercentileRank } from '../lib/percentile'

// ── Row shapes returned from DB queries ──────────────────────────────────────

interface EventMetricsRow {
  event_id: string
  organizer_id: string
  category: string
  total_capacity: number
  tickets_sold: number
  sell_through_rate: number
  average_ticket_price_czk: number
  page_views: number
  conversion_rate: number
  days_to_sell_out: number | null
  days_before_event: number
  event_date: string
  measured_at: string
}

interface SellThroughProgressionRow {
  measured_at: string
  sell_through_rate: number
  event_id: string
}

interface LeaderboardRow {
  event_id: string
  organizer_id: string
  category: string
  total_capacity: number
  tickets_sold: number
  sell_through_rate: number
  average_ticket_price_czk: number
  page_views: number
  conversion_rate: number
  days_to_sell_out: number | null
  days_before_event: number
  event_date: string
  measured_at: string
}

// ── Helper ────────────────────────────────────────────────────────────────────

function rowToMetrics(row: EventMetricsRow): EventMetrics {
  return {
    eventId: row.event_id,
    organizerId: row.organizer_id,
    category: row.category,
    totalCapacity: row.total_capacity,
    ticketsSold: row.tickets_sold,
    sellThroughRate: row.sell_through_rate,
    averageTicketPriceCzk: row.average_ticket_price_czk,
    pageViews: row.page_views,
    conversionRate: row.conversion_rate,
    daysToSellOut: row.days_to_sell_out,
    daysBeforeEvent: row.days_before_event,
    eventDate: new Date(row.event_date),
    measuredAt: new Date(row.measured_at),
  }
}

// ── Service functions ─────────────────────────────────────────────────────────

/**
 * Retrieve metrics for a specific event from the event_metrics table.
 * Falls back to computing from orders/tickets + page_views if no direct row.
 */
export async function getEventMetrics(
  eventId: string,
  deps: ServiceDeps,
): Promise<EventMetrics> {
  const { db } = deps

  // Try event_metrics table first
  const rows = await db.query<EventMetricsRow>(
    `SELECT * FROM event_metrics WHERE event_id = $1 ORDER BY measured_at DESC LIMIT 1`,
    [eventId],
  )

  if (rows.length > 0 && rows[0] !== undefined) {
    return rowToMetrics(rows[0])
  }

  // Fallback: compute from orders + page_views
  const computed = await db.query<EventMetricsRow>(
    `
    SELECT
      e.id AS event_id,
      e.organizer_id,
      e.category,
      e.total_capacity,
      COALESCE(SUM(t.quantity), 0) AS tickets_sold,
      COALESCE(SUM(t.quantity), 0)::float / NULLIF(e.total_capacity, 0) AS sell_through_rate,
      COALESCE(AVG(t.price_czk), 0) AS average_ticket_price_czk,
      COALESCE(pv.page_views, 0) AS page_views,
      CASE
        WHEN COALESCE(pv.page_views, 0) = 0 THEN 0
        ELSE COALESCE(SUM(t.quantity), 0)::float / pv.page_views
      END AS conversion_rate,
      NULL AS days_to_sell_out,
      EXTRACT(DAY FROM (e.event_date - NOW())) AS days_before_event,
      e.event_date,
      NOW() AS measured_at
    FROM events e
    LEFT JOIN tickets t ON t.event_id = e.id AND t.status = 'sold'
    LEFT JOIN (
      SELECT event_id, COUNT(*) AS page_views FROM page_views GROUP BY event_id
    ) pv ON pv.event_id = e.id
    WHERE e.id = $1
    GROUP BY e.id, e.organizer_id, e.category, e.total_capacity, pv.page_views, e.event_date
    `,
    [eventId],
  )

  if (computed.length === 0 || computed[0] === undefined) {
    throw new BenchmarkingError('EVENT_NOT_FOUND', `Event not found: ${eventId}`)
  }

  return rowToMetrics(computed[0])
}

/**
 * Find peer events and compute percentile benchmarks for a target event.
 */
export async function benchmarkEvent(
  eventId: string,
  peer: BenchmarkPeer,
  deps: ServiceDeps,
): Promise<BenchmarkResult> {
  const { db, now = () => new Date() } = deps
  const currentDate = now()

  const targetEvent = await getEventMetrics(eventId, deps)

  // Build peer query — same category, capacity within ±50%, within timeWindowDays
  const windowStart = new Date(currentDate)
  windowStart.setDate(windowStart.getDate() - peer.timeWindowDays)

  const peerRows = await db.query<EventMetricsRow>(
    `
    SELECT DISTINCT ON (em.event_id) em.*
    FROM event_metrics em
    WHERE em.category = $1
      AND em.event_id != $2
      AND em.total_capacity BETWEEN $3 AND $4
      AND em.measured_at >= $5
      ${peer.cityFilter !== null ? 'AND em.city = $6' : ''}
    ORDER BY em.event_id, em.measured_at DESC
    `,
    peer.cityFilter !== null
      ? [
          peer.category,
          eventId,
          peer.capacityRange.min,
          peer.capacityRange.max,
          windowStart.toISOString(),
          peer.cityFilter,
        ]
      : [
          peer.category,
          eventId,
          peer.capacityRange.min,
          peer.capacityRange.max,
          windowStart.toISOString(),
        ],
  )

  if (peerRows.length < 3) {
    throw new BenchmarkingError(
      'INSUFFICIENT_PEERS',
      `Not enough peer events for benchmarking (found ${peerRows.length}, need at least 3)`,
    )
  }

  const peers = peerRows.map(rowToMetrics)

  const sellThroughValues = peers.map((p) => p.sellThroughRate)
  const priceValues = peers.map((p) => p.averageTicketPriceCzk)
  const conversionValues = peers.map((p) => p.conversionRate)

  const percentiles = {
    sellThroughRate: {
      p25: calculatePercentile(sellThroughValues, 25),
      p50: calculatePercentile(sellThroughValues, 50),
      p75: calculatePercentile(sellThroughValues, 75),
      target: targetEvent.sellThroughRate,
      percentileRank: getPercentileRank(sellThroughValues, targetEvent.sellThroughRate),
    },
    averageTicketPriceCzk: {
      p25: calculatePercentile(priceValues, 25),
      p50: calculatePercentile(priceValues, 50),
      p75: calculatePercentile(priceValues, 75),
      target: targetEvent.averageTicketPriceCzk,
      percentileRank: getPercentileRank(priceValues, targetEvent.averageTicketPriceCzk),
    },
    conversionRate: {
      p25: calculatePercentile(conversionValues, 25),
      p50: calculatePercentile(conversionValues, 50),
      p75: calculatePercentile(conversionValues, 75),
      target: targetEvent.conversionRate,
      percentileRank: getPercentileRank(conversionValues, targetEvent.conversionRate),
    },
  }

  const partial: Omit<BenchmarkResult, 'insights'> = {
    targetEvent,
    peers,
    peerCount: peers.length,
    percentiles,
  }

  const insights = generateInsights(partial)

  return { ...partial, insights }
}

/**
 * Pure function — generate human-readable insights from benchmark result.
 */
export function generateInsights(
  result: Omit<BenchmarkResult, 'insights'>,
): string[] {
  const insights: string[] = []
  const { targetEvent, percentiles } = result

  const str = percentiles.sellThroughRate
  const cvr = percentiles.conversionRate
  const price = percentiles.averageTicketPriceCzk

  // Sell-through rate insights
  if (targetEvent.sellThroughRate > str.p75) {
    insights.push('Tvá akce patří do nejlepšího kvartilu prodejů v kategorii.')
  } else if (targetEvent.sellThroughRate < str.p25) {
    insights.push(
      'Sell-through rate je pod průměrem podobných akcí — zvaž promo kampaň.',
    )
  } else if (
    targetEvent.sellThroughRate >= str.p25 &&
    targetEvent.sellThroughRate <= str.p75
  ) {
    const pct = Math.round(targetEvent.sellThroughRate * 100)
    const p50pct = Math.round(str.p50 * 100)
    insights.push(
      `Tvůj festival prodal ${pct} % — podobné akce průměrně ${p50pct} %.`,
    )
  }

  // Conversion rate insight
  if (targetEvent.conversionRate < cvr.p50) {
    insights.push(
      'Konverzní poměr stránky je nižší než u podobných akcí — optimalizuj popis a fotky.',
    )
  }

  // Price insight
  if (targetEvent.averageTicketPriceCzk > price.p75) {
    insights.push(
      'Průměrná cena vstupenky je v nejvyšším kvartilu — zvažte zda cena neodrazuje zákazníky.',
    )
  } else if (targetEvent.averageTicketPriceCzk < price.p25) {
    insights.push(
      'Průměrná cena vstupenky je nižší než u podobných akcí — máte prostor pro navýšení cen.',
    )
  }

  // Days to sell out insight
  if (targetEvent.daysToSellOut !== null) {
    const peersSoldOut = result.peers
      .filter((p) => p.daysToSellOut !== null)
      .map((p) => p.daysToSellOut as number)

    if (peersSoldOut.length > 0) {
      const avgDays = Math.round(
        peersSoldOut.reduce((a, b) => a + b, 0) / peersSoldOut.length,
      )
      if (targetEvent.daysToSellOut < avgDays) {
        insights.push(
          `Akce se vyprodala za ${targetEvent.daysToSellOut} dní — podobné akce průměrně za ${avgDays} dní. Skvělý výsledek!`,
        )
      } else {
        insights.push(
          `Akce se vyprodala za ${targetEvent.daysToSellOut} dní — podobné akce průměrně za ${avgDays} dní.`,
        )
      }
    }
  }

  return insights
}

export interface SellThroughDataPoint {
  measuredAt: Date
  sellThroughRate: number
  eventId: string
}

export interface SellThroughProgression {
  target: SellThroughDataPoint[]
  peerAverage: SellThroughDataPoint[]
}

/**
 * Return a time series of sell-through rate for target event + peer average.
 */
export async function compareSellThroughProgression(
  eventId: string,
  deps: ServiceDeps,
): Promise<SellThroughProgression> {
  const { db } = deps

  const targetRows = await db.query<SellThroughProgressionRow>(
    `SELECT measured_at, sell_through_rate, event_id
     FROM event_metrics
     WHERE event_id = $1
     ORDER BY measured_at ASC`,
    [eventId],
  )

  if (targetRows.length === 0) {
    throw new BenchmarkingError(
      'METRICS_NOT_AVAILABLE',
      `No historical metrics for event: ${eventId}`,
    )
  }

  const targetMetrics = await getEventMetrics(eventId, deps)

  // Find peers by same category and similar capacity
  const minCapacity = Math.floor(targetMetrics.totalCapacity * 0.5)
  const maxCapacity = Math.ceil(targetMetrics.totalCapacity * 1.5)

  const peerRows = await db.query<SellThroughProgressionRow>(
    `SELECT em.measured_at, AVG(em.sell_through_rate) AS sell_through_rate, 'peer_avg' AS event_id
     FROM event_metrics em
     WHERE em.category = $1
       AND em.event_id != $2
       AND em.total_capacity BETWEEN $3 AND $4
     GROUP BY em.measured_at
     ORDER BY em.measured_at ASC`,
    [targetMetrics.category, eventId, minCapacity, maxCapacity],
  )

  return {
    target: targetRows.map((r) => ({
      measuredAt: new Date(r.measured_at),
      sellThroughRate: r.sell_through_rate,
      eventId: r.event_id,
    })),
    peerAverage: peerRows.map((r) => ({
      measuredAt: new Date(r.measured_at),
      sellThroughRate: r.sell_through_rate,
      eventId: r.event_id,
    })),
  }
}

/**
 * Return top 5 events for an organiser sorted by sell-through rate (descending).
 */
export async function getOrganiserLeaderboard(
  organizerId: string,
  deps: ServiceDeps,
): Promise<EventMetrics[]> {
  const { db } = deps

  const rows = await db.query<LeaderboardRow>(
    `SELECT DISTINCT ON (em.event_id) em.*
     FROM event_metrics em
     WHERE em.organizer_id = $1
     ORDER BY em.event_id, em.measured_at DESC`,
    [organizerId],
  )

  return rows
    .map(rowToMetrics)
    .sort((a, b) => b.sellThroughRate - a.sellThroughRate)
    .slice(0, 5)
}
