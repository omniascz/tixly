import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  runDetection,
  sweepRecentOrders,
  computeTotalScore,
  deriveRecommendation,
  setFraudQueueIngest,
  type FraudQueueIngestFn,
} from '../services/detection-runner.service.js';
import type { ServiceDeps } from '../lib/service-container.js';
import type { AnomalySignal } from '../types/detection.js';
import { DEFAULT_DETECTOR_CONFIG } from '../types/detection.js';

function sig(overrides: Partial<AnomalySignal> = {}): AnomalySignal {
  return {
    type: 'velocity_spike',
    severity: 'high',
    confidence: 100,
    description: 'test',
    linkedEntityIds: [],
    detectedAt: new Date(),
    ...overrides,
  };
}

describe('computeTotalScore', () => {
  it('sums severity weights × confidence correctly', () => {
    const signals: AnomalySignal[] = [
      sig({ severity: 'high', confidence: 100 }), // 50
      sig({ severity: 'medium', confidence: 50 }), // 12.5
    ];
    expect(computeTotalScore(signals)).toBe(63);
  });

  it('clamps at 100', () => {
    const signals: AnomalySignal[] = [
      sig({ severity: 'critical', confidence: 100 }),
      sig({ severity: 'critical', confidence: 100 }),
    ];
    expect(computeTotalScore(signals)).toBe(100);
  });
});

describe('deriveRecommendation', () => {
  it('returns block when score >= blockThreshold', () => {
    expect(deriveRecommendation(85, DEFAULT_DETECTOR_CONFIG)).toBe('block');
  });
  it('returns review when score >= reviewThreshold', () => {
    expect(deriveRecommendation(60, DEFAULT_DETECTOR_CONFIG)).toBe('review');
  });
  it('returns allow otherwise', () => {
    expect(deriveRecommendation(10, DEFAULT_DETECTOR_CONFIG)).toBe('allow');
  });
});

describe('runDetection', () => {
  let ingestMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ingestMock = vi.fn().mockResolvedValue(undefined);
    setFraudQueueIngest(ingestMock as unknown as FraudQueueIngestFn);
  });

  afterEach(() => {
    setFraudQueueIngest(null);
  });

  function makeDeps(queryRows: Array<unknown[]>): ServiceDeps {
    let call = 0;
    return {
      db: {
        query: vi.fn(async () => {
          const r = queryRows[call] ?? [];
          call++;
          return r;
        }) as ServiceDeps['db']['query'],
        execute: vi.fn().mockResolvedValue(undefined),
      },
      kafka: { send: vi.fn().mockResolvedValue(undefined) },
    };
  }

  it('pushes case to fraud-queue when above review threshold', async () => {
    // For subjectType='user': 3 queries (velocity, circular, geo) + patterns
    // Velocity > 10 → critical (100)
    const deps = makeDeps([
      [{ cnt: 12, ids: ['o1'] }], // velocity spike
      [], // circular refund
      [], // geo jump
      // pattern queries return empty
    ]);
    const report = await runDetection('user', 'u1', DEFAULT_DETECTOR_CONFIG, deps);
    expect(report.recommendation).toBe('block');
    expect(ingestMock).toHaveBeenCalledOnce();
    const payload = ingestMock.mock.calls[0]![0];
    expect(payload.sourceModule).toBe('ai-fraud-detection');
    expect(payload.sourceRefId).toBe('user:u1');
    expect(payload.severity).toBe('critical');
  });

  it('does not push when score below review threshold', async () => {
    const deps = makeDeps([
      [{ cnt: 2, ids: [] }], // no velocity spike
      [],
      [],
    ]);
    const report = await runDetection('user', 'u1', DEFAULT_DETECTOR_CONFIG, deps);
    expect(report.recommendation).toBe('allow');
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it('emits fraud.detected.block kafka event when blocking', async () => {
    const deps = makeDeps([[{ cnt: 12, ids: ['o1'] }], [], []]);
    await runDetection('user', 'u1', DEFAULT_DETECTOR_CONFIG, deps);
    expect(deps.kafka.send).toHaveBeenCalledWith(
      'fraud.detected.block',
      expect.objectContaining({ subjectType: 'user', subjectId: 'u1' }),
    );
  });

  it('throws INVALID_THRESHOLD for bad config', async () => {
    const deps = makeDeps([]);
    await expect(
      runDetection('user', 'u1', { reviewThreshold: 90, blockThreshold: 50, lookbackHours: 24 }, deps),
    ).rejects.toMatchObject({ code: 'INVALID_THRESHOLD' });
  });
});

describe('sweepRecentOrders', () => {
  it('processes batch and reports counts', async () => {
    let call = 0;
    // 1st query: list recent orders. then 4 queries per order (price, time, amount, velocity) + pattern queries.
    // We'll return 2 orders, then mostly-empty results → allow → flagged=0.
    const deps: ServiceDeps = {
      db: {
        query: vi.fn(async (sql: string) => {
          call++;
          if (/FROM orders\.orders[\s\S]*ORDER BY created_at DESC[\s\S]*LIMIT 5000/.test(sql)) {
            return [{ id: 'o1' }, { id: 'o2' }];
          }
          if (/SELECT user_id, promoter_id FROM orders\.orders WHERE id/.test(sql)) {
            return [{ user_id: 'u1', promoter_id: 'p1' }];
          }
          return [];
        }) as ServiceDeps['db']['query'],
        execute: vi.fn().mockResolvedValue(undefined),
      },
      kafka: { send: vi.fn() },
    };

    const result = await sweepRecentOrders(24, DEFAULT_DETECTOR_CONFIG, deps);
    expect(result.scanned).toBe(2);
    expect(result.flagged).toBe(0);
    expect(result.blocked).toBe(0);
    expect(call).toBeGreaterThan(0);
  });
});
