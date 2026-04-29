import { describe, it, expect, vi } from 'vitest';
import {
  calculateSustainability,
  getSustainabilityMetrics,
  enableDigitalSignage,
} from '../services/sustainability.service.js';
import type { DbAdapter } from '../services/sustainability.service.js';

const EVENT_ID = 'event-001';

function makeMetricsRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'metrics-001',
    event_id: EVENT_ID,
    attendee_count: 5000,
    venue_energy_kwh: 2000,
    co2_transport_tonnes: 52.5,      // 5000 × 25 × 2 × 0.21 / 1000
    co2_venue_energy_tonnes: 0.8,    // 2000 × 0.4 / 1000
    co2_total_tonnes: 53.3,
    carbon_offset_recommendations: ['Offset...', 'Partnership...'],
    waste_reduction_tips: ['Vratné kelímky', 'Bez plastu'],
    digital_signage_enabled: false,
    tree_equivalent: 54,             // ceil(53.3)
    calculated_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeDb(queryResults: unknown[][] = []): DbAdapter {
  let callIdx = 0;
  return {
    query: vi.fn(async () => {
      const result = queryResults[callIdx] ?? [];
      callIdx++;
      return result;
    }),
    execute: vi.fn(),
    transaction: vi.fn(async (fn) => fn({
      query: vi.fn().mockResolvedValue([]),
      execute: vi.fn(),
      transaction: vi.fn(),
    } as DbAdapter)),
  };
}

describe('calculateSustainability', () => {
  it('počítá CO₂ emise z dopravy a energie', async () => {
    const db = makeDb([[makeMetricsRow()]]);

    const result = await calculateSustainability({
      eventId: EVENT_ID,
      attendeeCount: 5000,
      venueEnergyKwh: 2000,
      averageDistanceKm: 25,
    }, db);

    expect(result.attendeeCount).toBe(5000);
    expect(result.co2TransportTonnes).toBeCloseTo(52.5, 1);  // 5000 × 25 × 2 × 0.21 / 1000
    expect(result.co2VenueEnergyTonnes).toBeCloseTo(0.8, 1); // 2000 × 0.4 / 1000
    expect(result.treeEquivalent).toBe(54);
  });

  it('generuje carbon offset a waste reduction recommendations', async () => {
    const db = makeDb([[makeMetricsRow()]]);

    const result = await calculateSustainability({
      eventId: EVENT_ID,
      attendeeCount: 5000,
      venueEnergyKwh: 2000,
    }, db);

    expect(result.carbonOffsetRecommendations.length).toBeGreaterThan(0);
    expect(result.wasteReductionTips.length).toBeGreaterThan(0);
    expect(result.carbonOffsetRecommendations[0]).toContain('Offset');
  });

  it('používá default průměrnou vzdálenost pokud není uvedena', async () => {
    const db = makeDb([[makeMetricsRow()]]);

    const result = await calculateSustainability({
      eventId: EVENT_ID,
      attendeeCount: 1000,
      venueEnergyKwh: 500,
      // averageDistanceKm not provided → default 25 km
    }, db);

    // Transport = 1000 × 25 × 2 × 0.21 / 1000 = 10.5 tonnes
    expect(result.co2TransportTonnes).toBeCloseTo(10.5, 1);
  });
});

describe('getSustainabilityMetrics', () => {
  it('vrátí sustainability metriky pro event', async () => {
    const db = makeDb([[makeMetricsRow()]]);

    const result = await getSustainabilityMetrics(EVENT_ID, db);

    expect(result).not.toBeNull();
    expect(result?.eventId).toBe(EVENT_ID);
    expect(result?.co2TotalTonnes).toBeCloseTo(53.3, 1);
  });

  it('vrátí null pokud metriky neexistují', async () => {
    const db = makeDb([[]]);

    const result = await getSustainabilityMetrics(EVENT_ID, db);

    expect(result).toBeNull();
  });
});

describe('enableDigitalSignage', () => {
  it('nastaví digital_signage_enabled = true', async () => {
    const db = makeDb([[makeMetricsRow({ digital_signage_enabled: true })]]);

    const result = await enableDigitalSignage(EVENT_ID, db);

    expect(result.digitalSignageEnabled).toBe(true);
  });

  it('vyhodí NOT_FOUND pokud metriky neexistují', async () => {
    const db = makeDb([[]]);

    await expect(enableDigitalSignage(EVENT_ID, db)).rejects.toThrow('NOT_FOUND');
  });
});
