import { describe, it, expect, vi } from 'vitest';
import { computeFingerprint, hashIp } from '../lib/fingerprint.js';
import {
  recordFingerprint,
  checkVelocity,
  assessDevice,
  assessRisk,
} from '../services/device.service.js';
import { DeviceError, isDeviceError } from '../lib/device-errors.js';
import type { BehaviorSignals } from '../lib/behavior-scorer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  acceptLanguage: 'en-US',
  screenResolution: '1920x1080',
  timezone: 'Europe/Prague',
  platform: 'Win32',
  colorDepth: 24,
  hardwareConcurrency: 8,
};

const defaultLimits = [
  { dimension: 'fingerprint', max_count: 5 },
  { dimension: 'ip', max_count: 10 },
  { dimension: 'user', max_count: 3 },
];

// ---------------------------------------------------------------------------
// 1. computeFingerprint — consistent hash for same signals
// ---------------------------------------------------------------------------
describe('computeFingerprint', () => {
  it('returns consistent hash for same signals', () => {
    const h1 = computeFingerprint(baseSignals);
    const h2 = computeFingerprint(baseSignals);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  // 2. different signals → different hash
  it('returns different hash for different signals', () => {
    const h1 = computeFingerprint(baseSignals);
    const h2 = computeFingerprint({ ...baseSignals, userAgent: 'Safari/600' });
    expect(h1).not.toBe(h2);
  });
});

// ---------------------------------------------------------------------------
// 3. hashIp — consistent hash
// ---------------------------------------------------------------------------
describe('hashIp', () => {
  it('returns consistent hash for same IP', () => {
    const h1 = hashIp('10.0.0.1');
    const h2 = hashIp('10.0.0.1');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });
});

// ---------------------------------------------------------------------------
// 4. recordFingerprint
// ---------------------------------------------------------------------------
describe('recordFingerprint', () => {
  it('inserts with correct params', async () => {
    const db = makeDb();
    const result = await recordFingerprint(
      { signals: baseSignals, userId: 'a1b2c3d4-0000-0000-0000-000000000001', eventId: 'a1b2c3d4-0000-0000-0000-000000000002', orderId: 'a1b2c3d4-0000-0000-0000-000000000003', action: 'checkout' },
      { db },
    );

    expect(db.execute).toHaveBeenCalledOnce();
    const [sql, params] = db.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO risk.device_fingerprints');
    expect(params).toHaveLength(7);
    expect(params[0]).toBe(result.fingerprintHash);
    expect(params[1]).toBe('a1b2c3d4-0000-0000-0000-000000000001');
    expect(params[2]).toBe(result.ipHash);
    // params[3] is userAgentHash (non-null string)
    expect(typeof params[3]).toBe('string');
    expect(params[4]).toBe('a1b2c3d4-0000-0000-0000-000000000002');
    expect(params[5]).toBe('a1b2c3d4-0000-0000-0000-000000000003');
    expect(params[6]).toBe('checkout');
  });

  // 5. without optional fields → nulls
  it('inserts null for optional fields when not provided', async () => {
    const db = makeDb();
    await recordFingerprint({ signals: { ipAddress: '1.2.3.4' } }, { db });

    const [, params] = db.execute.mock.calls[0] as [string, unknown[]];
    expect(params[1]).toBeNull(); // userId
    expect(params[3]).toBeNull(); // userAgentHash (no userAgent in signals)
    expect(params[4]).toBeNull(); // eventId
    expect(params[5]).toBeNull(); // orderId
    expect(params[6]).toBe('checkout'); // default action
  });
});

// ---------------------------------------------------------------------------
// checkVelocity helpers
// When userId IS provided: queryResults order = [fp, ip, user, limits]
// When userId is undefined: queryResults order = [fp, ip, limits]  (user resolved inline)
// ---------------------------------------------------------------------------

describe('checkVelocity', () => {
  const fp = computeFingerprint(baseSignals);
  const ip = hashIp(baseSignals.ipAddress);

  // 6. under all limits → exceedsLimit=false, riskScore=0
  it('returns exceedsLimit=false and riskScore=0 when under all limits', async () => {
    const db = makeDb([
      [{ count: '2' }],     // fp
      [{ count: '3' }],     // ip
      [{ count: '1' }],     // user
      defaultLimits,        // limits
    ]);
    const result = await checkVelocity(fp, ip, 'user-uuid', { db });
    expect(result.exceedsLimit).toBe(false);
    expect(result.riskScore).toBe(0);
    expect(result.signals).toHaveLength(0);
  });

  // 7. fingerprint at limit → exceedsLimit=true, riskScore includes 40
  it('exceeds fingerprint limit → exceedsLimit=true, riskScore includes 40', async () => {
    const db = makeDb([
      [{ count: '5' }],     // fp at limit
      [{ count: '2' }],     // ip under
      [{ count: '0' }],     // user
      defaultLimits,
    ]);
    const result = await checkVelocity(fp, ip, 'user-uuid', { db });
    expect(result.exceedsLimit).toBe(true);
    expect(result.riskScore).toBeGreaterThanOrEqual(40);
    expect(result.signals.some(s => s.includes('fingerprint') && s.includes('5/5'))).toBe(true);
  });

  // 8. ip at limit → exceedsLimit=true, riskScore includes 35
  it('exceeds ip limit → exceedsLimit=true, riskScore includes 35', async () => {
    const db = makeDb([
      [{ count: '1' }],     // fp under
      [{ count: '10' }],    // ip at limit
      [{ count: '0' }],     // user
      defaultLimits,
    ]);
    const result = await checkVelocity(fp, ip, 'user-uuid', { db });
    expect(result.exceedsLimit).toBe(true);
    expect(result.riskScore).toBeGreaterThanOrEqual(35);
    expect(result.signals.some(s => s.includes('ip') && s.includes('10/10'))).toBe(true);
  });

  // 9. user at limit → exceedsLimit=true, riskScore includes 25
  it('exceeds user limit → exceedsLimit=true, riskScore includes 25', async () => {
    const db = makeDb([
      [{ count: '1' }],     // fp
      [{ count: '2' }],     // ip
      [{ count: '3' }],     // user at limit
      defaultLimits,
    ]);
    const result = await checkVelocity(fp, ip, 'user-uuid', { db });
    expect(result.exceedsLimit).toBe(true);
    expect(result.riskScore).toBeGreaterThanOrEqual(25);
    expect(result.signals.some(s => s.includes('user') && s.includes('3/3'))).toBe(true);
  });

  // 10. approaching fp limit (70%) → not exceeded, riskScore=15
  it('approaching fp limit (70%) → not exceeded, riskScore=15', async () => {
    // 70% of 5 = 3.5, so count=4 qualifies (4 >= 3.5)
    const db = makeDb([
      [{ count: '4' }],     // fp approaching (4 >= 5*0.7=3.5)
      [{ count: '2' }],     // ip under
      [{ count: '0' }],     // user
      defaultLimits,
    ]);
    const result = await checkVelocity(fp, ip, 'user-uuid', { db });
    expect(result.exceedsLimit).toBe(false);
    expect(result.riskScore).toBe(15);
    expect(result.signals.some(s => s.includes('approaching') && s.includes('fingerprint'))).toBe(true);
  });

  // 11. approaching ip limit → not exceeded, riskScore=10
  it('approaching ip limit → not exceeded, riskScore=10', async () => {
    // 70% of 10 = 7, so count=8 qualifies
    const db = makeDb([
      [{ count: '1' }],     // fp under
      [{ count: '8' }],     // ip approaching (8 >= 10*0.7=7)
      [{ count: '0' }],     // user
      defaultLimits,
    ]);
    const result = await checkVelocity(fp, ip, 'user-uuid', { db });
    expect(result.exceedsLimit).toBe(false);
    expect(result.riskScore).toBe(10);
    expect(result.signals.some(s => s.includes('approaching') && s.includes('ip'))).toBe(true);
  });

  // 12. all limits exceeded → riskScore capped at 100
  it('all limits exceeded → riskScore capped at 100', async () => {
    const db = makeDb([
      [{ count: '5' }],     // fp at limit  (+40)
      [{ count: '10' }],    // ip at limit  (+35)
      [{ count: '3' }],     // user at limit (+25)
      defaultLimits,        // total = 100
    ]);
    const result = await checkVelocity(fp, ip, 'user-uuid', { db });
    expect(result.exceedsLimit).toBe(true);
    expect(result.riskScore).toBe(100);
  });

  // 13. without userId → userCount=0, no user signal
  it('without userId → userCount=0, no user risk signal', async () => {
    // No userId: only 3 DB queries (fp, ip, limits); user resolved inline as [{count:'0'}]
    const db = makeDb([
      [{ count: '1' }],     // fp
      [{ count: '2' }],     // ip
      defaultLimits,        // limits
    ]);
    const result = await checkVelocity(fp, ip, undefined, { db });
    expect(result.userCount).toBe(0);
    expect(result.signals.every(s => !s.includes('user'))).toBe(true);
    // db.query called 3 times (fp, ip, limits) — NOT 4
    expect(db.query).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// assessDevice
// ---------------------------------------------------------------------------
describe('assessDevice', () => {
  const input = {
    signals: baseSignals,
    userId: 'a1b2c3d4-0000-0000-0000-000000000099',
  };

  // 14. records and returns combined result
  it('records fingerprint and returns combined assessment', async () => {
    const db = makeDb([
      [{ count: '1' }], [{ count: '2' }], [{ count: '0' }], defaultLimits,
    ]);
    const result = await assessDevice(input, { db });
    expect(result.fingerprintHash).toHaveLength(64);
    expect(result.ipHash).toHaveLength(64);
    expect(result.velocity).toBeDefined();
    expect(db.execute).toHaveBeenCalledOnce();
  });

  // 15. allowed=true when under limits
  it('allowed=true when under limits', async () => {
    const db = makeDb([
      [{ count: '1' }], [{ count: '2' }], [{ count: '0' }], defaultLimits,
    ]);
    const result = await assessDevice(input, { db });
    expect(result.allowed).toBe(true);
  });

  // 16. allowed=false when over limit
  it('allowed=false when over limit', async () => {
    const db = makeDb([
      [{ count: '5' }], [{ count: '1' }], [{ count: '0' }], defaultLimits,
    ]);
    const result = await assessDevice(input, { db });
    expect(result.allowed).toBe(false);
  });

  // 17. velocity.signals contains velocity_check strings
  it('velocity.signals contains velocity_check strings when limit exceeded', async () => {
    const db = makeDb([
      [{ count: '5' }], [{ count: '10' }], [{ count: '0' }], defaultLimits,
    ]);
    const result = await assessDevice(input, { db });
    expect(result.velocity.signals.length).toBeGreaterThan(0);
    expect(result.velocity.signals.every(s => s.startsWith('velocity_check:'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST route
// ---------------------------------------------------------------------------
describe('POST /api/device/fingerprint', () => {
  async function callRoute(body: unknown, deps: ReturnType<typeof makeDb>) {
    const { POST } = await import('../app/api/device/fingerprint/route.js');
    const req = new Request('http://localhost/api/device/fingerprint', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
    // NextRequest wraps a standard Request
    const { NextRequest } = await import('next/dist/server/web/spec-extension/request.js');
    const nextReq = new NextRequest(req);
    return POST(nextReq, { deps: { db: deps } });
  }

  // 18. 200 with valid body and under limits
  it('returns 200 with valid body and under limits', async () => {
    const db = makeDb([
      [{ count: '1' }], [{ count: '2' }], defaultLimits,
    ]);
    const res = await callRoute(
      { ipAddress: '1.2.3.4', userAgent: 'TestAgent' },
      db,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as { allowed: boolean };
    expect(json.allowed).toBe(true);
  });

  // 19. 429 when velocity exceeded
  it('returns 429 when velocity exceeded', async () => {
    const db = makeDb([
      [{ count: '5' }], [{ count: '1' }], defaultLimits,
    ]);
    const res = await callRoute(
      { ipAddress: '1.2.3.4', userAgent: 'TestAgent' },
      db,
    );
    expect(res.status).toBe(429);
    const json = await res.json() as { allowed: boolean };
    expect(json.allowed).toBe(false);
  });

  // 20. 400 for invalid body (missing ipAddress)
  it('returns 400 for invalid body missing ipAddress', async () => {
    const db = makeDb();
    const res = await callRoute({ userAgent: 'TestAgent' }, db);
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('VALIDATION_ERROR');
  });

  // 21. 400 for invalid JSON body
  it('returns 400 for invalid JSON body', async () => {
    const { POST } = await import('../app/api/device/fingerprint/route.js');
    const { NextRequest } = await import('next/dist/server/web/spec-extension/request.js');
    const req = new Request('http://localhost/api/device/fingerprint', {
      method: 'POST',
      body: 'not-valid-json{{{',
      headers: { 'Content-Type': 'application/json' },
    });
    const nextReq = new NextRequest(req);
    const res = await POST(nextReq, { deps: { db: makeDb() } });
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('INVALID_JSON');
  });

  // 22. DeviceError thrown by service is returned as HTTP error
  it('returns DeviceError status when service throws DeviceError', async () => {
    const { POST } = await import('../app/api/device/fingerprint/route.js');
    const { NextRequest } = await import('next/dist/server/web/spec-extension/request.js');
    const db = {
      query: vi.fn().mockRejectedValue(new DeviceError('FINGERPRINT_BLOCKED')),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const req = new Request('http://localhost/api/device/fingerprint', {
      method: 'POST',
      body: JSON.stringify({ ipAddress: '1.2.3.4' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const nextReq = new NextRequest(req);
    const res = await POST(nextReq, { deps: { db } });
    expect(res.status).toBe(403);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('FINGERPRINT_BLOCKED');
  });
});

// ---------------------------------------------------------------------------
// DeviceError
// ---------------------------------------------------------------------------
describe('DeviceError', () => {
  it('creates error with correct code and default message', () => {
    const err = new DeviceError('VELOCITY_EXCEEDED');
    expect(err.code).toBe('VELOCITY_EXCEEDED');
    expect(err.statusCode).toBe(429);
    expect(err.message).toBe('Purchase velocity limit exceeded');
    expect(err.name).toBe('DeviceError');
  });

  it('allows custom message override', () => {
    const err = new DeviceError('INVALID_SIGNALS', 'custom msg');
    expect(err.message).toBe('custom msg');
    expect(err.statusCode).toBe(400);
  });

  it('toHttpError() returns structured object', () => {
    const err = new DeviceError('FINGERPRINT_BLOCKED');
    const http = err.toHttpError();
    expect(http).toEqual({
      error: 'FINGERPRINT_BLOCKED',
      statusCode: 403,
      message: 'Device fingerprint is blocked',
    });
  });

  it('isDeviceError returns true for DeviceError instances', () => {
    expect(isDeviceError(new DeviceError('VELOCITY_EXCEEDED'))).toBe(true);
  });

  it('isDeviceError returns false for plain Error', () => {
    expect(isDeviceError(new Error('plain'))).toBe(false);
  });

  it('isDeviceError returns false for non-errors', () => {
    expect(isDeviceError(null)).toBe(false);
    expect(isDeviceError('string')).toBe(false);
    expect(isDeviceError(42)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assessRisk
// ---------------------------------------------------------------------------

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

describe('assessRisk', () => {
  const fpHash = computeFingerprint(baseSignals);

  it('returns allow recommendation for human behavior with low account sharing', async () => {
    const db = makeDb([
      [{ count: '1' }], // 1 distinct account in 24h
    ]);
    const result = await assessRisk(fpHash, humanBehavior, { db });
    expect(result.recommendation).toBe('allow');
    expect(result.level).toBe('human');
    expect(result.overallScore).toBeLessThan(30);
    expect(result.distinctAccounts24h).toBe(1);
    expect(result.behavior.level).toBe('human');
  });

  it('returns block recommendation for bot behavior', async () => {
    const db = makeDb([
      [{ count: '0' }],
    ]);
    const result = await assessRisk(fpHash, botBehavior, { db });
    expect(result.recommendation).toBe('block');
    expect(result.level).toBe('bot');
    expect(result.overallScore).toBeGreaterThanOrEqual(70);
  });

  it('returns challenge recommendation for suspicious behavior', async () => {
    // Low mouse variance (score += 30) puts us in suspicious range
    const suspiciousBehavior: BehaviorSignals = {
      ...humanBehavior,
      mouseVarianceX: 2,
      mouseVarianceY: 3,
    };
    const db = makeDb([
      [{ count: '2' }],
    ]);
    const result = await assessRisk(fpHash, suspiciousBehavior, { db });
    expect(result.recommendation).toBe('challenge');
    expect(result.level).toBe('suspicious');
    expect(result.overallScore).toBeGreaterThanOrEqual(30);
    expect(result.overallScore).toBeLessThan(70);
  });

  it('adds fingerprint_shared reason when >5 accounts share fingerprint in 24h', async () => {
    const db = makeDb([
      [{ count: '8' }], // 8 distinct accounts
    ]);
    const result = await assessRisk(fpHash, humanBehavior, { db });
    expect(result.reasons.some(r => r.includes('fingerprint_shared'))).toBe(true);
    expect(result.reasons.some(r => r.includes('8 accounts'))).toBe(true);
    expect(result.distinctAccounts24h).toBe(8);
    expect(result.overallScore).toBeGreaterThanOrEqual(20);
  });

  it('does not add fingerprint_shared for 5 or fewer accounts', async () => {
    const db = makeDb([
      [{ count: '5' }],
    ]);
    const result = await assessRisk(fpHash, humanBehavior, { db });
    expect(result.reasons.every(r => !r.includes('fingerprint_shared'))).toBe(true);
    expect(result.distinctAccounts24h).toBe(5);
  });

  it('caps overallScore at 100 even with bot behavior + high sharing', async () => {
    const db = makeDb([
      [{ count: '20' }], // many shared accounts → +20
    ]);
    const result = await assessRisk(fpHash, botBehavior, { db });
    expect(result.overallScore).toBeLessThanOrEqual(100);
    expect(result.level).toBe('bot');
    expect(result.recommendation).toBe('block');
  });

  it('handles empty DB result gracefully (0 distinct accounts)', async () => {
    const db = makeDb([
      [{ count: '0' }],
    ]);
    const result = await assessRisk(fpHash, humanBehavior, { db });
    expect(result.distinctAccounts24h).toBe(0);
    expect(result.recommendation).toBe('allow');
  });

  it('handles missing count field in DB row (defaults to 0)', async () => {
    const db = makeDb([
      [{}], // no count field
    ]);
    const result = await assessRisk(fpHash, humanBehavior, { db });
    expect(result.distinctAccounts24h).toBe(0);
  });

  it('includes behavior score reasons in the overall reasons', async () => {
    const rushedBehavior: BehaviorSignals = {
      ...humanBehavior,
      timeOnPageMs: 500,
    };
    const db = makeDb([
      [{ count: '0' }],
    ]);
    const result = await assessRisk(fpHash, rushedBehavior, { db });
    expect(result.reasons.some(r => r.includes('rushed_checkout'))).toBe(true);
  });

  it('queries the correct DB table with fingerprint hash', async () => {
    const db = makeDb([
      [{ count: '0' }],
    ]);
    await assessRisk(fpHash, humanBehavior, { db });
    expect(db.query).toHaveBeenCalledOnce();
    const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('risk.device_fingerprints');
    expect(sql).toContain('COUNT(DISTINCT user_id)');
    expect(params![0]).toBe(fpHash);
  });
});

// ---------------------------------------------------------------------------
// POST /api/device/risk-assess
// ---------------------------------------------------------------------------
describe('POST /api/device/risk-assess', () => {
  const fpHash = computeFingerprint(baseSignals);

  async function callRiskRoute(body: unknown, deps: ReturnType<typeof makeDb>) {
    const { POST } = await import('../app/api/device/risk-assess/route.js');
    const req = new Request('http://localhost/api/device/risk-assess', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
    const { NextRequest } = await import('next/dist/server/web/spec-extension/request.js');
    const nextReq = new NextRequest(req);
    return POST(nextReq, { deps: { db: deps } });
  }

  it('returns 200 with allow recommendation for human behavior', async () => {
    const db = makeDb([
      [{ count: '1' }],
    ]);
    const res = await callRiskRoute(
      { fingerprintHash: fpHash, behaviorSignals: humanBehavior },
      db,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as { recommendation: string; level: string };
    expect(json.recommendation).toBe('allow');
    expect(json.level).toBe('human');
  });

  it('returns 403 with block recommendation for bot behavior', async () => {
    const db = makeDb([
      [{ count: '0' }],
    ]);
    const res = await callRiskRoute(
      { fingerprintHash: fpHash, behaviorSignals: botBehavior },
      db,
    );
    expect(res.status).toBe(403);
    const json = await res.json() as { recommendation: string; level: string };
    expect(json.recommendation).toBe('block');
    expect(json.level).toBe('bot');
  });

  it('returns 200 with challenge recommendation for suspicious behavior', async () => {
    const suspiciousBehavior: BehaviorSignals = {
      ...humanBehavior,
      mouseVarianceX: 2,
      mouseVarianceY: 3,
    };
    const db = makeDb([
      [{ count: '2' }],
    ]);
    const res = await callRiskRoute(
      { fingerprintHash: fpHash, behaviorSignals: suspiciousBehavior },
      db,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as { recommendation: string; level: string };
    expect(json.recommendation).toBe('challenge');
    expect(json.level).toBe('suspicious');
  });

  it('returns 400 for invalid JSON body', async () => {
    const { POST } = await import('../app/api/device/risk-assess/route.js');
    const { NextRequest } = await import('next/dist/server/web/spec-extension/request.js');
    const req = new Request('http://localhost/api/device/risk-assess', {
      method: 'POST',
      body: '{not valid json',
      headers: { 'Content-Type': 'application/json' },
    });
    const nextReq = new NextRequest(req);
    const res = await POST(nextReq, { deps: { db: makeDb() } });
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('INVALID_JSON');
  });

  it('returns 400 for missing fingerprintHash', async () => {
    const db = makeDb();
    const res = await callRiskRoute(
      { behaviorSignals: humanBehavior },
      db,
    );
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for missing behaviorSignals', async () => {
    const db = makeDb();
    const res = await callRiskRoute(
      { fingerprintHash: fpHash },
      db,
    );
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when fingerprintHash is too short', async () => {
    const db = makeDb();
    const res = await callRiskRoute(
      { fingerprintHash: 'short', behaviorSignals: humanBehavior },
      db,
    );
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when behaviorSignals has invalid field types', async () => {
    const db = makeDb();
    const res = await callRiskRoute(
      {
        fingerprintHash: fpHash,
        behaviorSignals: { ...humanBehavior, mouseMovements: 'not-a-number' },
      },
      db,
    );
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when behaviorSignals has negative values', async () => {
    const db = makeDb();
    const res = await callRiskRoute(
      {
        fingerprintHash: fpHash,
        behaviorSignals: { ...humanBehavior, mouseMovements: -1 },
      },
      db,
    );
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('VALIDATION_ERROR');
  });

  it('returns DeviceError status when service throws DeviceError', async () => {
    const db = {
      query: vi.fn().mockRejectedValue(new DeviceError('FINGERPRINT_BLOCKED')),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const res = await callRiskRoute(
      { fingerprintHash: fpHash, behaviorSignals: humanBehavior },
      db,
    );
    expect(res.status).toBe(403);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('FINGERPRINT_BLOCKED');
  });

  it('response includes all expected fields', async () => {
    const db = makeDb([
      [{ count: '0' }],
    ]);
    const res = await callRiskRoute(
      { fingerprintHash: fpHash, behaviorSignals: humanBehavior },
      db,
    );
    const json = await res.json() as Record<string, unknown>;
    expect(json).toHaveProperty('overallScore');
    expect(json).toHaveProperty('level');
    expect(json).toHaveProperty('reasons');
    expect(json).toHaveProperty('behavior');
    expect(json).toHaveProperty('distinctAccounts24h');
    expect(json).toHaveProperty('recommendation');
  });
});
