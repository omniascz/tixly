import { describe, it, expect, vi } from 'vitest';
import {
  createSeries,
  getSeries,
  listSeries,
  addEventToSeries,
  removeEventFromSeries,
  getSeriesEvents,
  refreshSeriesMetrics,
  getSeriesMetrics,
  updateSeries,
  deleteSeries,
} from '../services/tour.service.js';
import type { DbAdapter } from '../services/tour.service.js';

const SERIES_ID = 'series-001';
const PROMOTER_ID = 'promoter-001';
const EVENT_ID = 'event-001';

function makeSeriesRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SERIES_ID,
    promoter_id: PROMOTER_ID,
    name: 'European Summer Tour 2026',
    series_type: 'tour',
    description: 'A 10-city European tour',
    artwork_url: 'https://cdn.example.com/tour-art.jpg',
    start_date: '2026-06-01',
    end_date: '2026-08-31',
    is_active: true,
    created_at: '2026-04-14T10:00:00Z',
    updated_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeSeriesEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'se-001',
    series_id: SERIES_ID,
    event_id: EVENT_ID,
    leg_number: 1,
    is_headline: true,
    custom_name: 'Prague Night',
    created_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeSeriesMetricsRow(overrides: Record<string, unknown> = {}) {
  return {
    series_id: SERIES_ID,
    total_events: 10,
    total_capacity: 50000,
    total_sold: 40000,
    total_revenue_hellers: '200000000000',  // 2,000,000 CZK
    avg_occupancy_pct: '80.00',
    last_calculated_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeDb(queryResults: unknown[][] = [], executeMock = vi.fn()): DbAdapter {
  let callIdx = 0;
  return {
    query: vi.fn(async () => {
      const result = queryResults[callIdx] ?? [];
      callIdx++;
      return result;
    }),
    execute: executeMock,
    transaction: vi.fn(async (fn) => fn({
      query: vi.fn().mockResolvedValue([]),
      execute: executeMock,
      transaction: vi.fn(),
    } as DbAdapter)),
  };
}

describe('createSeries', () => {
  it('vytvoří nové turné/sérii', async () => {
    const db = makeDb([[makeSeriesRow()]]);

    const result = await createSeries(PROMOTER_ID, {
      name: 'European Summer Tour 2026',
      seriesType: 'tour',
      startDate: '2026-06-01',
      endDate: '2026-08-31',
    }, db);

    expect(result.name).toBe('European Summer Tour 2026');
    expect(result.seriesType).toBe('tour');
  });

  it('vyhodí VALIDATION_ERROR bez názvu', async () => {
    const db = makeDb([]);

    await expect(
      createSeries(PROMOTER_ID, { name: '', seriesType: 'tour' }, db),
    ).rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('getSeries', () => {
  it('vrátí sérii podle ID (tenant-scoped)', async () => {
    const db = makeDb([[makeSeriesRow()]]);

    const result = await getSeries(SERIES_ID, PROMOTER_ID, db);

    expect(result).not.toBeNull();
    expect(result?.seriesType).toBe('tour');
  });

  it('vrátí null pokud série neexistuje', async () => {
    const db = makeDb([[]]);

    const result = await getSeries('nonexistent', PROMOTER_ID, db);

    expect(result).toBeNull();
  });
});

describe('listSeries', () => {
  it('vrátí všechny série promotéra', async () => {
    const db = makeDb([[
      makeSeriesRow({ id: 's1' }),
      makeSeriesRow({ id: 's2', name: 'Winter Tour 2026', series_type: 'festival' }),
    ]]);

    const result = await listSeries(PROMOTER_ID, db);

    expect(result).toHaveLength(2);
    expect(result[1].seriesType).toBe('festival');
  });
});

describe('addEventToSeries', () => {
  it('přidá event do turné jako turné leg', async () => {
    const db = makeDb([[makeSeriesEventRow()]]);

    const result = await addEventToSeries(
      SERIES_ID,
      EVENT_ID,
      { legNumber: 1, isHeadline: true, customName: 'Prague Night' },
      db,
    );

    expect(result.legNumber).toBe(1);
    expect(result.isHeadline).toBe(true);
  });
});

describe('removeEventFromSeries', () => {
  it('odstraní event ze série', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeDb([], executeMock);

    await removeEventFromSeries(SERIES_ID, EVENT_ID, db);

    expect(executeMock).toHaveBeenCalledTimes(1);
    const sql = executeMock.mock.calls[0][0] as string;
    expect(sql).toContain('DELETE');
    expect(sql).toContain('series_id = $1');
  });
});

describe('getSeriesEvents', () => {
  it('vrátí všechny eventy v sérii (seřazené leg_number)', async () => {
    const db = makeDb([[
      makeSeriesEventRow({ leg_number: 1 }),
      makeSeriesEventRow({ id: 'se-002', event_id: 'event-002', leg_number: 2 }),
    ]]);

    const result = await getSeriesEvents(SERIES_ID, db);

    expect(result).toHaveLength(2);
    expect(result[0].legNumber).toBe(1);
  });
});

describe('refreshSeriesMetrics', () => {
  it('přepočítá a uloží metriky série', async () => {
    const db = makeDb([[makeSeriesMetricsRow()]]);

    const result = await refreshSeriesMetrics(SERIES_ID, db);

    expect(result.totalEvents).toBe(10);
    expect(result.totalSold).toBe(40000);
    expect(result.avgOccupancyPct).toBe(80.0);
  });
});

describe('getSeriesMetrics', () => {
  it('vrátí uložené metriky série', async () => {
    const db = makeDb([[makeSeriesMetricsRow()]]);

    const result = await getSeriesMetrics(SERIES_ID, db);

    expect(result).not.toBeNull();
    expect(result?.totalCapacity).toBe(50000);
  });

  it('vrátí null pokud metriky neexistují', async () => {
    const db = makeDb([[]]);

    const result = await getSeriesMetrics(SERIES_ID, db);

    expect(result).toBeNull();
  });
});

describe('updateSeries', () => {
  it('aktualizuje sérii (tenant-scoped)', async () => {
    const db = makeDb([[makeSeriesRow({ name: 'Updated Tour' })]]);

    const result = await updateSeries(SERIES_ID, PROMOTER_ID, { name: 'Updated Tour' }, db);

    expect(result.name).toBe('Updated Tour');
  });

  it('vyhodí chybu bez polí k aktualizaci', async () => {
    const db = makeDb([]);

    await expect(updateSeries(SERIES_ID, PROMOTER_ID, {}, db)).rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('deleteSeries', () => {
  it('deaktivuje sérii (soft delete)', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeDb([], executeMock);

    await deleteSeries(SERIES_ID, PROMOTER_ID, db);

    expect(executeMock).toHaveBeenCalledTimes(1);
    const sql = executeMock.mock.calls[0][0] as string;
    expect(sql).toContain('is_active = false');
  });
});
