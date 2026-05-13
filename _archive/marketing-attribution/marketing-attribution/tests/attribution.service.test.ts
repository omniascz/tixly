import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  trackTouchPoint,
  recordConversion,
  getChannelPerformance,
  getConversionAttribution,
} from '../src/services/attribution.service';
import type {
  ServiceDeps,
  DbAdapter,
  EventBusAdapter,
  AttributedConversionRow,
} from '../src/services/attribution.service';
import type {
  TouchPoint,
  ConversionAttribution,
} from '../src/types/attribution.types';

// ---------------------------------------------------------------------------
// Helpers / factories
// ---------------------------------------------------------------------------

let _tpSeq = 0;
let _convSeq = 0;

function makeDbTouchPoint(
  overrides: Partial<TouchPoint> = {},
  createdAt = new Date('2026-04-05T10:00:00Z'),
): TouchPoint {
  _tpSeq++;
  return {
    id: `tp-${String(_tpSeq).padStart(3, '0')}`,
    sessionId: 'sess-abc',
    userId: null,
    eventId: null,
    utmParams: { source: 'google', medium: 'cpc' },
    channel: 'google_ads',
    referrer: null,
    createdAt,
    ...overrides,
  };
}

function makeConversion(
  overrides: Partial<ConversionAttribution> = {},
): ConversionAttribution {
  _convSeq++;
  return {
    id: `conv-${String(_convSeq).padStart(3, '0')}`,
    orderId: 'order-001',
    orderAmount: 50000,
    model: 'last_click',
    touchPoints: [],
    createdAt: new Date('2026-04-05T12:00:00Z'),
    ...overrides,
  };
}

function makeServiceDeps(
  dbOverrides: Partial<DbAdapter> = {},
  busOverrides: Partial<EventBusAdapter> = {},
): ServiceDeps {
  const db: DbAdapter = {
    insertTouchPoint: vi.fn(async (data) =>
      makeDbTouchPoint({ ...data } as Partial<TouchPoint>),
    ),
    getTouchPointsBySession: vi.fn(async () => []),
    insertConversionAttribution: vi.fn(async (data) =>
      makeConversion({ ...data } as Partial<ConversionAttribution>),
    ),
    getConversionAttributionByOrderId: vi.fn(async () => null),
    getAttributedConversions: vi.fn(async () => []),
    ...dbOverrides,
  };

  const eventBus: EventBusAdapter = {
    emit: vi.fn(async () => {}),
    ...busOverrides,
  };

  return { db, eventBus };
}

// ---------------------------------------------------------------------------
// trackTouchPoint
// ---------------------------------------------------------------------------

describe('trackTouchPoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns void (fire-and-forget, no return value)', () => {
    const deps = makeServiceDeps();
    const result = trackTouchPoint(deps, {
      sessionId: 'sess-1',
      utmParams: { source: 'google', medium: 'cpc' },
      referrer: null,
      channel: 'google_ads',
    });
    expect(result).toBeUndefined();
  });

  it('calls db.insertTouchPoint asynchronously with correct params', async () => {
    const insertSpy = vi.fn(async () => makeDbTouchPoint());
    const deps = makeServiceDeps({ insertTouchPoint: insertSpy });

    trackTouchPoint(deps, {
      sessionId: 'sess-fire',
      userId: 'user-42',
      eventId: 'evt-99',
      utmParams: { source: 'facebook' },
      referrer: null,
      channel: 'facebook',
    });

    // Allow async microtasks to settle
    await new Promise((r) => setTimeout(r, 10));

    expect(insertSpy).toHaveBeenCalledOnce();
    const call = insertSpy.mock.calls[0]![0];
    expect(call.sessionId).toBe('sess-fire');
    expect(call.userId).toBe('user-42');
    expect(call.eventId).toBe('evt-99');
    expect(call.channel).toBe('facebook');
  });

  it('emits a Kafka event to the correct topic after inserting', async () => {
    const emitSpy = vi.fn(async () => {});
    const deps = makeServiceDeps({}, { emit: emitSpy });

    trackTouchPoint(deps, {
      sessionId: 'sess-kafka',
      utmParams: null,
      referrer: null,
      channel: 'direct',
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(emitSpy).toHaveBeenCalledOnce();
    expect(emitSpy.mock.calls[0]![0]).toBe('tixly.attribution.touch-point');
  });

  it('does not throw when db.insertTouchPoint rejects', async () => {
    const deps = makeServiceDeps({
      insertTouchPoint: vi.fn(async () => {
        throw new Error('DB error');
      }),
    });

    expect(() =>
      trackTouchPoint(deps, {
        sessionId: 'sess-err',
        utmParams: null,
        referrer: null,
        channel: 'direct',
      }),
    ).not.toThrow();

    await new Promise((r) => setTimeout(r, 10));
  });
});

// ---------------------------------------------------------------------------
// recordConversion
// ---------------------------------------------------------------------------

describe('recordConversion', () => {
  it('returns a ConversionAttribution record', async () => {
    const tp = makeDbTouchPoint({ channel: 'google_ads' });
    const expectedConv = makeConversion({ orderId: 'order-100', model: 'last_click' });
    const deps = makeServiceDeps({
      getTouchPointsBySession: vi.fn(async () => [tp]),
      insertConversionAttribution: vi.fn(async () => expectedConv),
    });

    const result = await recordConversion(deps, 'order-100', 50000, 'sess-abc');
    expect(result.orderId).toBe(expectedConv.orderId);
    expect(result.model).toBe('last_click');
  });

  it('uses last_click as the default model', async () => {
    const insertSpy = vi.fn(async (data: Partial<ConversionAttribution>) =>
      makeConversion({ ...data } as Partial<ConversionAttribution>),
    );
    const tp = makeDbTouchPoint();
    const deps = makeServiceDeps({
      getTouchPointsBySession: vi.fn(async () => [tp]),
      insertConversionAttribution: insertSpy,
    });

    await recordConversion(deps, 'order-101', 10000, 'sess-abc');
    expect(insertSpy.mock.calls[0]![0].model).toBe('last_click');
  });

  it('uses the specified model when provided', async () => {
    const insertSpy = vi.fn(async (data: Partial<ConversionAttribution>) =>
      makeConversion({ ...data } as Partial<ConversionAttribution>),
    );
    const tps = [
      makeDbTouchPoint({ createdAt: new Date('2026-04-05T08:00:00Z') }),
      makeDbTouchPoint({ createdAt: new Date('2026-04-05T10:00:00Z') }),
    ];
    const deps = makeServiceDeps({
      getTouchPointsBySession: vi.fn(async () => tps),
      insertConversionAttribution: insertSpy,
    });

    await recordConversion(deps, 'order-102', 20000, 'sess-abc', 'linear');
    expect(insertSpy.mock.calls[0]![0].model).toBe('linear');
  });

  it('handles zero touch points gracefully (empty attribution)', async () => {
    const insertSpy = vi.fn(async (data: Partial<ConversionAttribution>) =>
      makeConversion({ ...data } as Partial<ConversionAttribution>),
    );
    const deps = makeServiceDeps({
      getTouchPointsBySession: vi.fn(async () => []),
      insertConversionAttribution: insertSpy,
    });

    await recordConversion(deps, 'order-103', 5000, 'sess-empty');
    expect(insertSpy.mock.calls[0]![0].touchPoints).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getChannelPerformance
// ---------------------------------------------------------------------------

describe('getChannelPerformance', () => {
  it('returns an empty array when there are no attributed conversions', async () => {
    const deps = makeServiceDeps({
      getAttributedConversions: vi.fn(async () => []),
    });

    const result = await getChannelPerformance(
      deps,
      'promoter-1',
      'evt-1',
      new Date('2026-04-01'),
      new Date('2026-04-30'),
    );
    expect(result).toEqual([]);
  });

  it('aggregates revenue correctly for a single channel', async () => {
    const rows: AttributedConversionRow[] = [
      { channel: 'google_ads', orderAmount: 50000, credit: 1 },
      { channel: 'google_ads', orderAmount: 30000, credit: 1 },
    ];
    const deps = makeServiceDeps({
      getAttributedConversions: vi.fn(async () => rows),
    });

    const result = await getChannelPerformance(
      deps,
      'promoter-1',
      'evt-1',
      new Date('2026-04-01'),
      new Date('2026-04-30'),
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.channel).toBe('google_ads');
    expect(result[0]!.attributedRevenue).toBe(80000);
    expect(result[0]!.touchPoints).toBe(2);
  });

  it('sorts channels by attributedRevenue descending', async () => {
    const rows: AttributedConversionRow[] = [
      { channel: 'email', orderAmount: 10000, credit: 1 },
      { channel: 'google_ads', orderAmount: 50000, credit: 1 },
      { channel: 'facebook', orderAmount: 30000, credit: 1 },
    ];
    const deps = makeServiceDeps({
      getAttributedConversions: vi.fn(async () => rows),
    });

    const result = await getChannelPerformance(
      deps,
      'promoter-1',
      'evt-1',
      new Date('2026-04-01'),
      new Date('2026-04-30'),
    );

    expect(result.map((r) => r.channel)).toEqual(['google_ads', 'facebook', 'email']);
  });

  it('handles partial linear credit correctly (revenue fraction)', async () => {
    const rows: AttributedConversionRow[] = [
      { channel: 'email', orderAmount: 30000, credit: 0.5 },
      { channel: 'facebook', orderAmount: 30000, credit: 0.5 },
    ];
    const deps = makeServiceDeps({
      getAttributedConversions: vi.fn(async () => rows),
    });

    const result = await getChannelPerformance(
      deps,
      'promoter-1',
      'evt-1',
      new Date('2026-04-01'),
      new Date('2026-04-30'),
    );

    const email = result.find((r) => r.channel === 'email');
    const fb = result.find((r) => r.channel === 'facebook');
    expect(email?.attributedRevenue).toBe(15000);
    expect(fb?.attributedRevenue).toBe(15000);
  });
});

// ---------------------------------------------------------------------------
// getConversionAttribution
// ---------------------------------------------------------------------------

describe('getConversionAttribution', () => {
  it('returns null when no conversion record exists', async () => {
    const deps = makeServiceDeps({
      getConversionAttributionByOrderId: vi.fn(async () => null),
    });
    const result = await getConversionAttribution(deps, 'order-nonexistent');
    expect(result).toBeNull();
  });

  it('returns the ConversionAttribution record when found', async () => {
    const conv = makeConversion({ orderId: 'order-999' });
    const deps = makeServiceDeps({
      getConversionAttributionByOrderId: vi.fn(async () => conv),
    });

    const result = await getConversionAttribution(deps, 'order-999');
    expect(result).not.toBeNull();
    expect(result!.orderId).toBe('order-999');
    expect(result!.id).toBe(conv.id);
  });
});
