import { describe, it, expect, vi } from 'vitest';
import { runBotGuard, type BotGuardInput } from '../lib/bot-guard.js';
import type { BehaviorSignals } from '../lib/behavior-scorer.js';

function makeDb(queryResults: unknown[][] = []) {
  let idx = 0;
  return {
    query: vi.fn().mockImplementation(() => Promise.resolve(queryResults[idx++] ?? [])),
    execute: vi.fn().mockResolvedValue(undefined),
  };
}

const baseSignals = {
  ipAddress: '192.168.1.1',
  userAgent: 'Mozilla/5.0',
  screenResolution: '1920x1080',
  timezone: 'Europe/Prague',
  platform: 'Win32',
  colorDepth: 24,
  hardwareConcurrency: 8,
};

const humanBehavior: BehaviorSignals = {
  mouseMovements: 250,
  mouseVarianceX: 120,
  mouseVarianceY: 90,
  clickCount: 4,
  avgClickIntervalMs: 1200,
  clickIntervalStddev: 450,
  keyPressCount: 12,
  timeOnPageMs: 45_000,
  focusBlurCount: 2,
  hasTouchEvents: false,
};

const botBehavior: BehaviorSignals = {
  mouseMovements: 0,
  mouseVarianceX: 0,
  mouseVarianceY: 0,
  clickCount: 10,
  avgClickIntervalMs: 10,
  clickIntervalStddev: 1,
  keyPressCount: 0,
  timeOnPageMs: 100,
  focusBlurCount: 0,
  hasTouchEvents: false,
};

const defaultLimits = [
  { dimension: 'fingerprint', max_count: 5 },
  { dimension: 'ip', max_count: 10 },
  { dimension: 'user', max_count: 3 },
];

function makeInput(overrides: Partial<BotGuardInput> = {}): BotGuardInput {
  return {
    signals: baseSignals,
    behavior: humanBehavior,
    userId: 'a1b2c3d4-0000-0000-0000-000000000001',
    eventId: 'a1b2c3d4-0000-0000-0000-000000000002',
    action: 'checkout',
    ...overrides,
  };
}

describe('runBotGuard', () => {
  it('allows human behavior with low velocity and not blocklisted', async () => {
    const db = makeDb([
      // assessDevice: recordFingerprint (execute) then checkVelocity queries
      [{ count: '1' }],   // fp velocity
      [{ count: '2' }],   // ip velocity
      [{ count: '0' }],   // user velocity
      defaultLimits,       // velocity limits
      [{ count: '0' }],   // blocklist check
      [{ count: '1' }],   // assessRisk distinct accounts
    ]);
    const result = await runBotGuard(makeInput(), { db });
    expect(result.allowed).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.risk.recommendation).toBe('allow');
    expect(result.reason).toBeUndefined();
  });

  it('blocks when fingerprint is on the blocklist', async () => {
    const db = makeDb([
      // assessDevice queries
      [{ count: '1' }],   // fp velocity
      [{ count: '2' }],   // ip velocity
      [{ count: '0' }],   // user velocity
      defaultLimits,
      [{ count: '1' }],   // blocklist check → BLOCKED
    ]);
    const result = await runBotGuard(makeInput(), { db });
    expect(result.allowed).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('fingerprint_blocklisted');
    expect(result.risk.overallScore).toBe(100);
    expect(result.risk.level).toBe('bot');
  });

  it('blocks when velocity is exceeded even with human behavior', async () => {
    const db = makeDb([
      [{ count: '5' }],   // fp at limit
      [{ count: '2' }],   // ip under
      [{ count: '0' }],   // user
      defaultLimits,
      [{ count: '0' }],   // not blocklisted
      [{ count: '1' }],   // assessRisk
    ]);
    const result = await runBotGuard(makeInput(), { db });
    expect(result.allowed).toBe(false);
    expect(result.blocked).toBe(false);
    expect(result.reason).toBe('velocity_exceeded');
  });

  it('blocks when bot behavior is detected even with low velocity', async () => {
    const db = makeDb([
      [{ count: '1' }],
      [{ count: '2' }],
      [{ count: '0' }],
      defaultLimits,
      [{ count: '0' }],   // not blocklisted
      [{ count: '0' }],   // assessRisk
    ]);
    const result = await runBotGuard(makeInput({ behavior: botBehavior }), { db });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('bot_detected');
    expect(result.risk.level).toBe('bot');
  });

  it('allows suspicious behavior (challenge, not block)', async () => {
    const suspicious: BehaviorSignals = {
      ...humanBehavior,
      mouseVarianceX: 2,
      mouseVarianceY: 3,
    };
    const db = makeDb([
      [{ count: '1' }],
      [{ count: '2' }],
      [{ count: '0' }],
      defaultLimits,
      [{ count: '0' }],
      [{ count: '2' }],
    ]);
    const result = await runBotGuard(makeInput({ behavior: suspicious }), { db });
    expect(result.allowed).toBe(true);
    expect(result.risk.recommendation).toBe('challenge');
    expect(result.risk.level).toBe('suspicious');
  });

  it('passes optional eventId and orderId through to assessDevice', async () => {
    const db = makeDb([
      [{ count: '0' }], [{ count: '0' }], [{ count: '0' }],
      defaultLimits, [{ count: '0' }], [{ count: '0' }],
    ]);
    const result = await runBotGuard(makeInput({
      eventId: 'e1e1e1e1-0000-0000-0000-000000000001',
      orderId: 'o2o2o2o2-0000-0000-0000-000000000001',
    }), { db });
    expect(result.allowed).toBe(true);
    expect(db.execute).toHaveBeenCalledOnce();
    const params = db.execute.mock.calls[0][1] as unknown[];
    expect(params[4]).toBe('e1e1e1e1-0000-0000-0000-000000000001');
    expect(params[5]).toBe('o2o2o2o2-0000-0000-0000-000000000001');
  });
});
