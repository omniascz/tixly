import {
  buildOccupancySnapshot,
  checkThresholds,
  type ScanSummary,
  type ZoneConfig,
} from '../lib/occupancy-calculator'
import type {
  OccupancyAlert,
  OccupancySnapshot,
  OccupancyThresholds,
} from '../types/occupancy.types'

// ---------------------------------------------------------------------------
// Port interfaces — injected at call sites, never imported from a concrete lib
// ---------------------------------------------------------------------------

export interface OccupancyDbAdapter {
  getScanSummaryByZone(eventId: string): Promise<
    Array<{
      zone_id: string
      zone_name: string
      zone_capacity: number | null
      check_in_count: number
      check_out_count: number
    }>
  >
  getEventCapacity(eventId: string): Promise<number>
  getOccupancyThresholds(eventId: string): Promise<OccupancyThresholds | null>
  saveOccupancySnapshot(snapshot: OccupancySnapshot): Promise<void>
  getLatestSnapshot(eventId: string): Promise<OccupancySnapshot | null>
  saveAlert(alert: OccupancyAlert): Promise<void>
  getActiveAlerts(eventId: string): Promise<OccupancyAlert[]>
  setOccupancyThresholds(eventId: string, thresholds: OccupancyThresholds): Promise<void>
}

export interface RedisAdapter {
  set(key: string, value: string, ttlSeconds: number): Promise<void>
  get(key: string): Promise<string | null>
  del(key: string): Promise<void>
  increment(key: string): Promise<number>
  decrement(key: string): Promise<number>
}

export interface KafkaProducerAdapter {
  publish(topic: string, payload: unknown): Promise<void>
}

// ---------------------------------------------------------------------------
// Redis key helpers
// ---------------------------------------------------------------------------

const cacheKey = (eventId: string) => `tixly:occupancy:${eventId}`
const totalKey = (eventId: string) => `tixly:occupancy:${eventId}:total`
const zoneKey = (eventId: string, zoneId: string) => `tixly:occupancy:${eventId}:zone:${zoneId}`

const CACHE_TTL_SECONDS = 5

// ---------------------------------------------------------------------------
// Default thresholds (applied when the event has none configured)
// ---------------------------------------------------------------------------

const DEFAULT_THRESHOLDS: Omit<OccupancyThresholds, 'event_id'> = {
  warning_pct: 80,
  critical_pct: 95,
  full_pct: 100,
  zone_thresholds: [],
}

// ---------------------------------------------------------------------------
// OccupancyService
// ---------------------------------------------------------------------------

export const OccupancyService = {
  /**
   * Returns the current occupancy snapshot.
   * Reads from Redis cache (TTL 5 s) before hitting the database.
   */
  async getCurrentOccupancy(
    eventId: string,
    db: OccupancyDbAdapter,
    redis: RedisAdapter,
  ): Promise<OccupancySnapshot> {
    // 1. Try Redis cache
    const cached = await redis.get(cacheKey(eventId))
    if (cached != null) {
      const parsed = JSON.parse(cached) as OccupancySnapshot
      // Dates are serialised as strings — restore them
      parsed.captured_at = new Date(parsed.captured_at)
      return parsed
    }

    // 2. Cache miss — rebuild from DB
    const [rawZones, totalCapacity] = await Promise.all([
      db.getScanSummaryByZone(eventId),
      db.getEventCapacity(eventId),
    ])

    const scans: ScanSummary[] = rawZones.map((row) => ({
      zone_id: row.zone_id,
      check_in_count: row.check_in_count,
      check_out_count: row.check_out_count,
    }))

    const zones: ZoneConfig[] = rawZones.map((row) => ({
      id: row.zone_id,
      name: row.zone_name,
      capacity: row.zone_capacity,
    }))

    // 3. Build snapshot
    const snapshot = buildOccupancySnapshot(eventId, scans, zones, totalCapacity, new Date())

    // 4. Store in Redis
    await redis.set(cacheKey(eventId), JSON.stringify(snapshot), CACHE_TTL_SECONDS)

    return snapshot
  },

  /**
   * Called by the gate/scan service on every ticket scan.
   * Atomically updates Redis counters and invalidates the snapshot cache.
   * Intentionally avoids a DB write for lowest possible latency.
   */
  async recordScanEvent(
    eventId: string,
    zoneId: string,
    eventType: 'check_in' | 'check_out',
    redis: RedisAdapter,
  ): Promise<void> {
    if (eventType === 'check_in') {
      await Promise.all([
        redis.increment(totalKey(eventId)),
        redis.increment(zoneKey(eventId, zoneId)),
      ])
    } else {
      await Promise.all([
        redis.decrement(totalKey(eventId)),
        redis.decrement(zoneKey(eventId, zoneId)),
      ])
    }

    // Invalidate the snapshot cache so the next GET rebuilds from DB/counters
    await redis.del(cacheKey(eventId))
  },

  /**
   * Full DB-sourced refresh — intended for the cron job.
   * Checks thresholds and publishes Kafka alerts for any breaches found.
   */
  async refreshSnapshot(
    eventId: string,
    db: OccupancyDbAdapter,
    redis: RedisAdapter,
    kafka: KafkaProducerAdapter,
  ): Promise<OccupancySnapshot> {
    const [rawZones, totalCapacity, thresholdsOrNull] = await Promise.all([
      db.getScanSummaryByZone(eventId),
      db.getEventCapacity(eventId),
      db.getOccupancyThresholds(eventId),
    ])

    const scans: ScanSummary[] = rawZones.map((row) => ({
      zone_id: row.zone_id,
      check_in_count: row.check_in_count,
      check_out_count: row.check_out_count,
    }))

    const zones: ZoneConfig[] = rawZones.map((row) => ({
      id: row.zone_id,
      name: row.zone_name,
      capacity: row.zone_capacity,
    }))

    const now = new Date()
    const snapshot = buildOccupancySnapshot(eventId, scans, zones, totalCapacity, now)

    const thresholds: OccupancyThresholds = thresholdsOrNull ?? {
      event_id: eventId,
      ...DEFAULT_THRESHOLDS,
    }

    const alerts = checkThresholds(snapshot, thresholds)

    // Persist alerts and publish to Kafka
    await Promise.all([
      ...alerts.map((alert) => db.saveAlert(alert)),
      ...alerts.map((alert) => kafka.publish('occupancy.alert', alert)),
    ])

    // Persist snapshot and warm the cache
    await Promise.all([
      db.saveOccupancySnapshot(snapshot),
      redis.set(cacheKey(eventId), JSON.stringify(snapshot), CACHE_TTL_SECONDS),
    ])

    return snapshot
  },

  /**
   * Persists threshold configuration for an event.
   */
  async setThresholds(
    eventId: string,
    thresholds: OccupancyThresholds,
    db: OccupancyDbAdapter,
  ): Promise<void> {
    await db.setOccupancyThresholds(eventId, thresholds)
  },

  /**
   * Returns all active (unresolved) alerts for an event.
   */
  async getEventAlerts(
    eventId: string,
    db: OccupancyDbAdapter,
  ): Promise<OccupancyAlert[]> {
    return db.getActiveAlerts(eventId)
  },
}
