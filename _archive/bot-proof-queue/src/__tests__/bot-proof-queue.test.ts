import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateChallengeToken,
  verifyChallengeToken,
  requiresChallenge,
} from '../services/challenge.service.js';
import { detectBotSignals } from '../services/bot-detector.service.js';
import {
  joinQueue,
  getQueuePosition,
  admitFromQueue,
  markVerified,
  rejectEntry,
  cleanupExpired,
  getQueueLength,
} from '../services/queue.service.js';
import type { DbAdapter, BotSignals } from '../lib/types.js';

// ---------------------------------------------------------------------------
// Mock DbAdapter factory
// ---------------------------------------------------------------------------

function makeDb(overrides: Partial<DbAdapter> = {}): DbAdapter {
  return {
    query: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (fn) => fn(makeDb(overrides))),
    ...overrides,
  };
}

const SECRET = 'test-secret-key-for-hmac';

const NOW_ISO = new Date().toISOString();
const FUTURE_ISO = new Date(Date.now() + 30 * 60 * 1000).toISOString();
const PAST_ISO = new Date(Date.now() - 60 * 60 * 1000).toISOString();

const baseQueueRow = {
  id: 'entry-1',
  event_id: 'ev-1',
  session_id: 'sess-1',
  ip_address: '192.168.0.1',
  user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  fingerprint_hash: 'abc123',
  position: 1,
  status: 'waiting',
  challenge_token: null,
  challenge_expires_at: null,
  admitted_at: null,
  created_at: NOW_ISO,
  expires_at: FUTURE_ISO,
};

const cleanBotSignals: BotSignals = {
  headlessBrowser: false,
  suspiciousUserAgent: false,
  rateLimit: false,
  datacenterIp: false,
  duplicateFingerprint: false,
};

// ---------------------------------------------------------------------------
// 1. generateChallengeToken
// ---------------------------------------------------------------------------
describe('generateChallengeToken', () => {
  it('1. returns token and expiresAt', () => {
    const result = generateChallengeToken('sess-1', SECRET);
    expect(result.token).toBeTruthy();
    expect(result.expiresAt).toBeTruthy();
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});

// ---------------------------------------------------------------------------
// 2-4. verifyChallengeToken
// ---------------------------------------------------------------------------
describe('verifyChallengeToken', () => {
  it('2. returns true for valid token', () => {
    const { token } = generateChallengeToken('sess-1', SECRET);
    expect(verifyChallengeToken(token, 'sess-1', SECRET)).toBe(true);
  });

  it('3. returns false for expired token (mocked Date)', () => {
    // Generate token that expires in 15 min, then advance time
    const { token } = generateChallengeToken('sess-1', SECRET);

    const originalNow = Date.now;
    Date.now = () => originalNow() + 16 * 60 * 1000; // +16 minutes

    try {
      expect(verifyChallengeToken(token, 'sess-1', SECRET)).toBe(false);
    } finally {
      Date.now = originalNow;
    }
  });

  it('4. returns false for tampered token', () => {
    const { token } = generateChallengeToken('sess-1', SECRET);
    const tampered = token.slice(0, -4) + 'XXXX';
    expect(verifyChallengeToken(tampered, 'sess-1', SECRET)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5-6. requiresChallenge
// ---------------------------------------------------------------------------
describe('requiresChallenge', () => {
  it('5. returns true if any signal is true', () => {
    expect(requiresChallenge({ ...cleanBotSignals, headlessBrowser: true })).toBe(true);
    expect(requiresChallenge({ ...cleanBotSignals, rateLimit: true })).toBe(true);
    expect(requiresChallenge({ ...cleanBotSignals, datacenterIp: true })).toBe(true);
  });

  it('6. returns false if all signals are false', () => {
    expect(requiresChallenge(cleanBotSignals)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7-12. detectBotSignals
// ---------------------------------------------------------------------------
describe('detectBotSignals', () => {
  const baseInput = {
    ipAddress: '192.168.0.1',
    requestsFromIpLast5min: 5,
    sameFingerPrintIpCount: 1,
  };

  it('7. headlessBrowser=true for HeadlessChrome UA', () => {
    const signals = detectBotSignals({
      ...baseInput,
      userAgent: 'Mozilla/5.0 HeadlessChrome/120.0',
    });
    expect(signals.headlessBrowser).toBe(true);
  });

  it('8. suspiciousUserAgent=true for UA < 10 chars', () => {
    const signals = detectBotSignals({
      ...baseInput,
      userAgent: 'curl',
    });
    expect(signals.suspiciousUserAgent).toBe(true);
  });

  it('9. rateLimit=true for requestsFromIpLast5min > 20', () => {
    const signals = detectBotSignals({
      ...baseInput,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
      requestsFromIpLast5min: 21,
    });
    expect(signals.rateLimit).toBe(true);
  });

  it('10. duplicateFingerprint=true for sameFingerPrintIpCount > 3', () => {
    const signals = detectBotSignals({
      ...baseInput,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
      sameFingerPrintIpCount: 4,
    });
    expect(signals.duplicateFingerprint).toBe(true);
  });

  it('11. datacenterIp=true for 10.x.x.x IP', () => {
    const signals = detectBotSignals({
      ...baseInput,
      ipAddress: '10.0.0.1',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
    });
    expect(signals.datacenterIp).toBe(true);
  });

  it('12. all false for normal request', () => {
    const signals = detectBotSignals({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      ipAddress: '203.0.113.42',
      requestsFromIpLast5min: 3,
      sameFingerPrintIpCount: 1,
    });
    expect(signals.headlessBrowser).toBe(false);
    expect(signals.suspiciousUserAgent).toBe(false);
    expect(signals.rateLimit).toBe(false);
    expect(signals.datacenterIp).toBe(false);
    expect(signals.duplicateFingerprint).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 13-14. joinQueue
// ---------------------------------------------------------------------------
describe('joinQueue', () => {
  it('13. creates entry with position > 0', async () => {
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([])                    // no existing entry
        .mockResolvedValueOnce([{ max_pos: 0 }]),     // current max position
    });

    const result = await joinQueue('ev-1', 'sess-new', '1.2.3.4', db);
    expect(result.position).toBeGreaterThan(0);
    expect(result.status).toBe('waiting');
    expect(result.sessionId).toBe('sess-new');
  });

  it('14. returns existing entry for duplicate sessionId', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([baseQueueRow]),
    });

    const result = await joinQueue('ev-1', 'sess-1', '1.2.3.4', db);
    expect(result.id).toBe('entry-1');
    expect(db.execute).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 15. getQueuePosition
// ---------------------------------------------------------------------------
describe('getQueuePosition', () => {
  it('15. returns position and estimatedWaitMinutes', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([{ ...baseQueueRow, position: 10 }]),
    });

    const result = await getQueuePosition('sess-1', 'ev-1', db);
    expect(result.position).toBe(10);
    expect(result.estimatedWaitMinutes).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 16-17. admitFromQueue
// ---------------------------------------------------------------------------
describe('admitFromQueue', () => {
  it('16. updates status to admitted for N entries', async () => {
    const entries = [
      { ...baseQueueRow, id: 'e1', position: 1 },
      { ...baseQueueRow, id: 'e2', position: 2 },
    ];
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce(entries),
    });

    await admitFromQueue('ev-1', 2, db);

    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'admitted'"),
      expect.any(Array),
    );
  });

  it('17. returns count of actually admitted entries', async () => {
    const entries = [{ ...baseQueueRow, id: 'e1' }];
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce(entries),
    });

    const count = await admitFromQueue('ev-1', 5, db);
    expect(count).toBe(1); // only 1 available even though 5 requested
  });
});

// ---------------------------------------------------------------------------
// 18. markVerified
// ---------------------------------------------------------------------------
describe('markVerified', () => {
  it('18. updates status to verified', async () => {
    const db = makeDb();

    await markVerified('entry-1', db);

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'verified'"),
      expect.arrayContaining(['entry-1']),
    );
  });
});

// ---------------------------------------------------------------------------
// 19. rejectEntry
// ---------------------------------------------------------------------------
describe('rejectEntry', () => {
  it('19. updates status to rejected', async () => {
    const db = makeDb();

    await rejectEntry('entry-1', 'BOT_DETECTED', db);

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'rejected'"),
      expect.any(Array),
    );
  });
});

// ---------------------------------------------------------------------------
// 20. cleanupExpired
// ---------------------------------------------------------------------------
describe('cleanupExpired', () => {
  it('20. returns count of cleaned up entries', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([
        { id: 'e1' },
        { id: 'e2' },
      ]),
    });

    const count = await cleanupExpired(db);
    expect(count).toBe(2);
    expect(db.execute).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 21. getQueueLength
// ---------------------------------------------------------------------------
describe('getQueueLength', () => {
  it('21. returns count of waiting+verified entries', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([{ count: '7' }]),
    });

    const length = await getQueueLength('ev-1', db);
    expect(length).toBe(7);
  });
});
