import { describe, expect, it } from 'vitest'
import {
  buildOccupancySnapshot,
  calculateOccupancy,
  calculateOccupancyPct,
  checkThresholds,
  formatOccupancyDisplay,
  type ScanSummary,
  type ZoneConfig,
} from './occupancy-calculator'
import type { OccupancySnapshot, OccupancyThresholds } from '../types/occupancy.types'

// ---------------------------------------------------------------------------
// calculateOccupancy
// ---------------------------------------------------------------------------

describe('calculateOccupancy', () => {
  it('returns checkins minus checkouts', () => {
    expect(calculateOccupancy(100, 30)).toBe(70)
  })

  it('returns 0 when checkins equal checkouts', () => {
    expect(calculateOccupancy(50, 50)).toBe(0)
  })

  it('returns 0 when checkouts exceed checkins (never negative)', () => {
    expect(calculateOccupancy(10, 25)).toBe(0)
  })

  it('returns full checkin count when there are no checkouts', () => {
    expect(calculateOccupancy(500, 0)).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// calculateOccupancyPct
// ---------------------------------------------------------------------------

describe('calculateOccupancyPct', () => {
  it('returns 0 % when nobody is inside', () => {
    expect(calculateOccupancyPct(0, 1000)).toBe(0)
  })

  it('returns 50 % for half capacity', () => {
    expect(calculateOccupancyPct(500, 1000)).toBe(50)
  })

  it('returns 100 % when at full capacity', () => {
    expect(calculateOccupancyPct(1000, 1000)).toBe(100)
  })

  it('caps at 100 % when over capacity', () => {
    expect(calculateOccupancyPct(1100, 1000)).toBe(100)
  })

  it('rounds to the nearest integer', () => {
    // 333 / 1000 = 33.3 → rounds to 33
    expect(calculateOccupancyPct(333, 1000)).toBe(33)
  })

  it('returns 0 when capacity is 0 (guard against division by zero)', () => {
    expect(calculateOccupancyPct(50, 0)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// buildOccupancySnapshot
// ---------------------------------------------------------------------------

const NOW = new Date('2026-08-15T21:00:00Z')

describe('buildOccupancySnapshot', () => {
  it('aggregates inside counts across multiple zones', () => {
    const scans: ScanSummary[] = [
      { zone_id: 'z1', check_in_count: 400, check_out_count: 50 },
      { zone_id: 'z2', check_in_count: 200, check_out_count: 20 },
    ]
    const zones: ZoneConfig[] = [
      { id: 'z1', name: 'Floor', capacity: 1000 },
      { id: 'z2', name: 'VIP', capacity: 300 },
    ]
    const snap = buildOccupancySnapshot('evt1', scans, zones, 1300, NOW)

    expect(snap.total_inside).toBe(530) // (400-50) + (200-20)
    expect(snap.total_capacity).toBe(1300)
    expect(snap.total_checked_in_ever).toBe(600) // 400 + 200
    expect(snap.zones).toHaveLength(2)
  })

  it('computes correct per-zone occupancy_pct', () => {
    const scans: ScanSummary[] = [
      { zone_id: 'z1', check_in_count: 800, check_out_count: 100 },
    ]
    const zones: ZoneConfig[] = [{ id: 'z1', name: 'Main', capacity: 1000 }]
    const snap = buildOccupancySnapshot('evt2', scans, zones, 1000, NOW)

    expect(snap.zones[0].inside).toBe(700)
    expect(snap.zones[0].occupancy_pct).toBe(70)
  })

  it('sets occupancy_pct to null for zone without capacity', () => {
    const scans: ScanSummary[] = [
      { zone_id: 'z-open', check_in_count: 300, check_out_count: 10 },
    ]
    const zones: ZoneConfig[] = [{ id: 'z-open', name: 'Open Area', capacity: null }]
    const snap = buildOccupancySnapshot('evt3', scans, zones, 2000, NOW)

    expect(snap.zones[0].capacity).toBeNull()
    expect(snap.zones[0].occupancy_pct).toBeNull()
  })

  it('handles a zone in the config that has no scans yet (defaults to 0)', () => {
    const scans: ScanSummary[] = []
    const zones: ZoneConfig[] = [{ id: 'z-empty', name: 'Empty Zone', capacity: 500 }]
    const snap = buildOccupancySnapshot('evt4', scans, zones, 500, NOW)

    expect(snap.zones[0].inside).toBe(0)
    expect(snap.zones[0].occupancy_pct).toBe(0)
    expect(snap.total_inside).toBe(0)
  })

  it('includes unknown zones (scans without matching zone config)', () => {
    const scans: ScanSummary[] = [
      { zone_id: 'unknown-zone', check_in_count: 50, check_out_count: 0 },
    ]
    const zones: ZoneConfig[] = []
    const snap = buildOccupancySnapshot('evt5', scans, zones, 1000, NOW)

    expect(snap.zones).toHaveLength(1)
    expect(snap.zones[0].zone_id).toBe('unknown-zone')
    expect(snap.zones[0].capacity).toBeNull()
  })

  it('stores the provided timestamp as captured_at', () => {
    const snap = buildOccupancySnapshot('evt6', [], [], 0, NOW)
    expect(snap.captured_at).toBe(NOW)
  })
})

// ---------------------------------------------------------------------------
// checkThresholds
// ---------------------------------------------------------------------------

const BASE_THRESHOLDS: OccupancyThresholds = {
  event_id: 'evt-t',
  warning_pct: 80,
  critical_pct: 95,
  full_pct: 100,
  zone_thresholds: [],
}

function makeSnapshot(overallPct: number, zones: OccupancySnapshot['zones'] = []): OccupancySnapshot {
  return {
    event_id: 'evt-t',
    captured_at: NOW,
    total_capacity: 1000,
    total_inside: Math.round(overallPct * 10),
    total_checked_in_ever: Math.round(overallPct * 10),
    occupancy_pct: overallPct,
    zones,
  }
}

describe('checkThresholds', () => {
  it('returns no alerts when below warning threshold', () => {
    const alerts = checkThresholds(makeSnapshot(60), BASE_THRESHOLDS)
    expect(alerts).toHaveLength(0)
  })

  it('triggers capacity_warning when at warning threshold', () => {
    const alerts = checkThresholds(makeSnapshot(80), BASE_THRESHOLDS)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].alert_type).toBe('capacity_warning')
    expect(alerts[0].threshold_pct).toBe(80)
  })

  it('triggers capacity_critical when at critical threshold', () => {
    const alerts = checkThresholds(makeSnapshot(95), BASE_THRESHOLDS)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].alert_type).toBe('capacity_critical')
    expect(alerts[0].threshold_pct).toBe(95)
  })

  it('triggers capacity_full at 100 % (not also critical)', () => {
    const alerts = checkThresholds(makeSnapshot(100), BASE_THRESHOLDS)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].alert_type).toBe('capacity_full')
  })

  it('triggers zone_full when zone threshold is exceeded', () => {
    const zoneSnap = makeSnapshot(50, [
      { zone_id: 'vip', zone_name: 'VIP', capacity: 200, inside: 200, occupancy_pct: 100 },
    ])
    const thresholds: OccupancyThresholds = {
      ...BASE_THRESHOLDS,
      zone_thresholds: [{ zone_id: 'vip', full_pct: 100 }],
    }
    const alerts = checkThresholds(zoneSnap, thresholds)
    const zoneAlert = alerts.find((a) => a.alert_type === 'zone_full')
    expect(zoneAlert).toBeDefined()
    expect(zoneAlert?.zone_id).toBe('vip')
  })

  it('does not trigger zone_full when zone is below its threshold', () => {
    const zoneSnap = makeSnapshot(50, [
      { zone_id: 'vip', zone_name: 'VIP', capacity: 200, inside: 150, occupancy_pct: 75 },
    ])
    const thresholds: OccupancyThresholds = {
      ...BASE_THRESHOLDS,
      zone_thresholds: [{ zone_id: 'vip', full_pct: 100 }],
    }
    const alerts = checkThresholds(zoneSnap, thresholds)
    expect(alerts.find((a) => a.alert_type === 'zone_full')).toBeUndefined()
  })

  it('skips zone_full check for zones with null occupancy_pct', () => {
    const zoneSnap = makeSnapshot(50, [
      { zone_id: 'open', zone_name: 'Open Area', capacity: null, inside: 300, occupancy_pct: null },
    ])
    const thresholds: OccupancyThresholds = {
      ...BASE_THRESHOLDS,
      zone_thresholds: [{ zone_id: 'open', full_pct: 100 }],
    }
    const alerts = checkThresholds(zoneSnap, thresholds)
    expect(alerts.find((a) => a.alert_type === 'zone_full')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// formatOccupancyDisplay
// ---------------------------------------------------------------------------

describe('formatOccupancyDisplay', () => {
  it('formats Czech output correctly', () => {
    const snap = makeSnapshot(62)
    // Override to give nice numbers
    const s = { ...snap, total_inside: 1247, total_capacity: 2000, occupancy_pct: 62 }
    expect(formatOccupancyDisplay(s, 'cs')).toMatch(/1\s?247\s?\/\s?2\s?000\s?\(62\s?%\)/)
  })

  it('formats English output correctly', () => {
    const s = { ...makeSnapshot(62), total_inside: 1247, total_capacity: 2000, occupancy_pct: 62 }
    expect(formatOccupancyDisplay(s, 'en')).toMatch(/1,247\s?\/\s?2,000\s?\(62%\)/)
  })

  it('returns "Vyprodáno" in Czech when sold out', () => {
    expect(formatOccupancyDisplay(makeSnapshot(100), 'cs')).toBe('Vyprodáno')
  })

  it('returns "Sold Out" in English when sold out', () => {
    expect(formatOccupancyDisplay(makeSnapshot(100), 'en')).toBe('Sold Out')
  })

  it('returns "Vyprodáno" in Czech even when over 100 %', () => {
    // occupancy_pct is capped at 100 by calculateOccupancyPct, but guard here anyway
    expect(formatOccupancyDisplay({ ...makeSnapshot(100), occupancy_pct: 100 }, 'cs')).toBe(
      'Vyprodáno',
    )
  })
})
