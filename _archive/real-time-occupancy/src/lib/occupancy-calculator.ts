import type {
  OccupancyAlert,
  OccupancySnapshot,
  OccupancyThresholds,
  ZoneOccupancy,
} from '../types/occupancy.types'

export interface ScanSummary {
  zone_id: string
  check_in_count: number
  check_out_count: number
}

export interface ZoneConfig {
  id: string
  name: string
  capacity: number | null
}

/**
 * Returns how many people are currently inside.
 * Never goes below 0 (guards against out-of-order scan events).
 */
export function calculateOccupancy(checkins: number, checkouts: number): number {
  return Math.max(0, checkins - checkouts)
}

/**
 * Returns occupancy as a percentage, capped at 100.
 * Assumes capacity > 0.
 */
export function calculateOccupancyPct(inside: number, capacity: number): number {
  if (capacity <= 0) return 0
  return Math.min(100, Math.round((inside / capacity) * 100))
}

/**
 * Builds a full OccupancySnapshot from per-zone scan summaries and zone configs.
 */
export function buildOccupancySnapshot(
  eventId: string,
  scans: ScanSummary[],
  zones: ZoneConfig[],
  totalCapacity: number,
  now: Date,
): OccupancySnapshot {
  const scanByZone = new Map<string, ScanSummary>()
  for (const scan of scans) {
    scanByZone.set(scan.zone_id, scan)
  }

  const zoneOccupancies: ZoneOccupancy[] = zones.map((zone) => {
    const scan = scanByZone.get(zone.id)
    const checkIns = scan?.check_in_count ?? 0
    const checkOuts = scan?.check_out_count ?? 0
    const inside = calculateOccupancy(checkIns, checkOuts)
    const occupancyPct =
      zone.capacity != null ? calculateOccupancyPct(inside, zone.capacity) : null

    return {
      zone_id: zone.id,
      zone_name: zone.name,
      capacity: zone.capacity,
      inside,
      occupancy_pct: occupancyPct,
    }
  })

  // Also include scans for zones not found in the zone config list (unknown zones)
  for (const scan of scans) {
    const alreadyAdded = zones.some((z) => z.id === scan.zone_id)
    if (!alreadyAdded) {
      const inside = calculateOccupancy(scan.check_in_count, scan.check_out_count)
      zoneOccupancies.push({
        zone_id: scan.zone_id,
        zone_name: scan.zone_id,
        capacity: null,
        inside,
        occupancy_pct: null,
      })
    }
  }

  const totalInside = zoneOccupancies.reduce((sum, z) => sum + z.inside, 0)
  const totalCheckedInEver = scans.reduce((sum, s) => sum + s.check_in_count, 0)
  const occupancyPct = calculateOccupancyPct(totalInside, totalCapacity)

  return {
    event_id: eventId,
    captured_at: now,
    total_capacity: totalCapacity,
    total_inside: totalInside,
    total_checked_in_ever: totalCheckedInEver,
    occupancy_pct: occupancyPct,
    zones: zoneOccupancies,
  }
}

/**
 * Compares a snapshot against thresholds and returns any newly-triggered alerts.
 * Checks overall capacity (warning / critical / full) and per-zone full threshold.
 */
export function checkThresholds(
  snapshot: OccupancySnapshot,
  thresholds: OccupancyThresholds,
): OccupancyAlert[] {
  const alerts: OccupancyAlert[] = []
  const now = new Date()
  const pct = snapshot.occupancy_pct

  if (pct >= thresholds.full_pct) {
    alerts.push({
      event_id: snapshot.event_id,
      alert_type: 'capacity_full',
      zone_id: null,
      threshold_pct: thresholds.full_pct,
      current_pct: pct,
      triggered_at: now,
    })
  } else if (pct >= thresholds.critical_pct) {
    alerts.push({
      event_id: snapshot.event_id,
      alert_type: 'capacity_critical',
      zone_id: null,
      threshold_pct: thresholds.critical_pct,
      current_pct: pct,
      triggered_at: now,
    })
  } else if (pct >= thresholds.warning_pct) {
    alerts.push({
      event_id: snapshot.event_id,
      alert_type: 'capacity_warning',
      zone_id: null,
      threshold_pct: thresholds.warning_pct,
      current_pct: pct,
      triggered_at: now,
    })
  }

  const zoneThresholdMap = new Map(
    thresholds.zone_thresholds.map((zt) => [zt.zone_id, zt.full_pct]),
  )

  for (const zone of snapshot.zones) {
    if (zone.occupancy_pct == null) continue
    const zoneFull = zoneThresholdMap.get(zone.zone_id)
    if (zoneFull != null && zone.occupancy_pct >= zoneFull) {
      alerts.push({
        event_id: snapshot.event_id,
        alert_type: 'zone_full',
        zone_id: zone.zone_id,
        threshold_pct: zoneFull,
        current_pct: zone.occupancy_pct,
        triggered_at: now,
      })
    }
  }

  return alerts
}

/**
 * Returns a human-readable occupancy string for gate staff displays.
 * Examples:
 *   cs: "1 247 / 2 000 (62 %)" or "Vyprodáno"
 *   en: "1,247 / 2,000 (62%)" or "Sold Out"
 */
export function formatOccupancyDisplay(
  snapshot: OccupancySnapshot,
  lang: 'cs' | 'en',
): string {
  if (snapshot.occupancy_pct >= 100) {
    return lang === 'cs' ? 'Vyprodáno' : 'Sold Out'
  }

  const locale = lang === 'cs' ? 'cs-CZ' : 'en-US'
  const inside = snapshot.total_inside.toLocaleString(locale)
  const capacity = snapshot.total_capacity.toLocaleString(locale)
  const pct = snapshot.occupancy_pct

  return lang === 'cs'
    ? `${inside} / ${capacity} (${pct} %)`
    : `${inside} / ${capacity} (${pct}%)`
}
