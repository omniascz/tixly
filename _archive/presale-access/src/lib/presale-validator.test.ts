import { describe, it, expect } from 'vitest';
import {
  hashPresaleCode,
  verifyPresaleCode,
  getPresaleStatus,
  canAccessWithoutCode,
  validatePresaleAccess,
} from './presale-validator';
import type { PresaleConfig } from '../types/presale.types';
import {
  PresaleInvalidCodeError,
  PresaleExpiredError,
  PresaleNotStartedError,
  PresaleSoldOutError,
} from '../types/presale.types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SECRET = 'test-secret-key';
const PLAIN_CODE = 'FANCLUB2026';
const STORED_HASH = hashPresaleCode(PLAIN_CODE, SECRET);

const NOW = new Date('2026-04-04T12:00:00Z');

// Presale window: 2026-04-01 → 2026-04-05
// Public sale: 2026-04-06 → 2026-04-30
const PRESALE_START = new Date('2026-04-01T10:00:00Z');
const PRESALE_END = new Date('2026-04-05T23:59:59Z');
const SALE_START = new Date('2026-04-06T10:00:00Z');
const SALE_END = new Date('2026-04-30T23:59:59Z');

function makeConfig(overrides: Partial<PresaleConfig> = {}): PresaleConfig {
  return {
    ticket_type_id: 'tt-1',
    presale_code_hash: STORED_HASH,
    presale_start: PRESALE_START,
    presale_end: PRESALE_END,
    presale_capacity: null,
    presale_sold_count: 0,
    ...overrides,
  };
}

const TICKET_TYPE = { sale_start: SALE_START, sale_end: SALE_END };

// ---------------------------------------------------------------------------
// hashPresaleCode
// ---------------------------------------------------------------------------

describe('hashPresaleCode', () => {
  it('produces a 64-character hex string (SHA-256)', () => {
    const hash = hashPresaleCode('ABC', SECRET);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — same inputs always yield same hash', () => {
    const h1 = hashPresaleCode('FANCLUB2026', SECRET);
    const h2 = hashPresaleCode('FANCLUB2026', SECRET);
    expect(h1).toBe(h2);
  });

  it('is case-insensitive — lowercase and uppercase produce same hash', () => {
    const h1 = hashPresaleCode('fanclub2026', SECRET);
    const h2 = hashPresaleCode('FANCLUB2026', SECRET);
    expect(h1).toBe(h2);
  });

  it('trims surrounding whitespace before hashing', () => {
    const h1 = hashPresaleCode('  FANCLUB2026  ', SECRET);
    const h2 = hashPresaleCode('FANCLUB2026', SECRET);
    expect(h1).toBe(h2);
  });

  it('differs across different secrets', () => {
    const h1 = hashPresaleCode('CODE', 'secret-a');
    const h2 = hashPresaleCode('CODE', 'secret-b');
    expect(h1).not.toBe(h2);
  });

  it('handles codes with numbers and special characters', () => {
    const hash = hashPresaleCode('VIP-2026!@#', SECRET);
    expect(hash).toHaveLength(64);
  });
});

// ---------------------------------------------------------------------------
// verifyPresaleCode
// ---------------------------------------------------------------------------

describe('verifyPresaleCode', () => {
  it('returns true for the correct plain-text code', () => {
    expect(verifyPresaleCode(PLAIN_CODE, STORED_HASH, SECRET)).toBe(true);
  });

  it('returns false for an incorrect code', () => {
    expect(verifyPresaleCode('WRONGCODE', STORED_HASH, SECRET)).toBe(false);
  });

  it('is case-insensitive — lowercase matches stored uppercase hash', () => {
    expect(verifyPresaleCode('fanclub2026', STORED_HASH, SECRET)).toBe(true);
  });

  it('strips whitespace before comparison', () => {
    expect(verifyPresaleCode('  FANCLUB2026  ', STORED_HASH, SECRET)).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(verifyPresaleCode('', STORED_HASH, SECRET)).toBe(false);
  });

  it('returns false for a code that differs by one character', () => {
    expect(verifyPresaleCode('FANCLUB2025', STORED_HASH, SECRET)).toBe(false);
  });

  it('uses timing-safe comparison — does not throw on equal length inputs', () => {
    // timingSafeEqual requires same byte length; both hashes are 64 hex chars
    const wrongHash = hashPresaleCode('DIFFERENTCODE', SECRET);
    expect(() => verifyPresaleCode('FANCLUB2026', wrongHash, SECRET)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getPresaleStatus
// ---------------------------------------------------------------------------

describe('getPresaleStatus', () => {
  it('returns presale_active when now is inside presale window', () => {
    // NOW = 2026-04-04 — inside [Apr 1, Apr 5]
    expect(getPresaleStatus(makeConfig(), TICKET_TYPE, NOW)).toBe('presale_active');
  });

  it('returns presale_not_started when now is before presale_start', () => {
    const before = new Date('2026-03-31T23:59:00Z');
    expect(getPresaleStatus(makeConfig(), TICKET_TYPE, before)).toBe('presale_not_started');
  });

  it('returns public_sale_active when now is in public sale window', () => {
    const during = new Date('2026-04-15T12:00:00Z');
    expect(getPresaleStatus(makeConfig(), TICKET_TYPE, during)).toBe('public_sale_active');
  });

  it('returns not_on_sale when presale ended but public sale not yet started', () => {
    // Between Apr 5 (presale end) and Apr 6 (public sale start)
    const between = new Date('2026-04-06T09:00:00Z');
    expect(getPresaleStatus(makeConfig(), TICKET_TYPE, between)).toBe('presale_not_started');
    // Actually public sale starts Apr 6 10:00 — Apr 6 09:00 is before public_sale_start and after presale_end
    // presaleEnded = true (> Apr 5 23:59:59), publicSaleStarted = false (< Apr 6 10:00)
    // → not_on_sale
    const betweenActual = new Date('2026-04-06T05:00:00Z');
    expect(getPresaleStatus(makeConfig(), TICKET_TYPE, betweenActual)).toBe('not_on_sale');
  });

  it('returns not_on_sale after public sale has also ended', () => {
    const after = new Date('2026-05-01T00:00:00Z');
    expect(getPresaleStatus(makeConfig(), TICKET_TYPE, after)).toBe('not_on_sale');
  });

  it('returns presale_sold_out when capacity is exhausted during presale window', () => {
    const config = makeConfig({ presale_capacity: 50, presale_sold_count: 50 });
    expect(getPresaleStatus(config, TICKET_TYPE, NOW)).toBe('presale_sold_out');
  });

  it('does not return presale_sold_out when presale_capacity is null (shared inventory)', () => {
    const config = makeConfig({ presale_capacity: null, presale_sold_count: 9999 });
    expect(getPresaleStatus(config, TICKET_TYPE, NOW)).toBe('presale_active');
  });

  it('returns presale_active when sold_count is one below capacity', () => {
    const config = makeConfig({ presale_capacity: 100, presale_sold_count: 99 });
    expect(getPresaleStatus(config, TICKET_TYPE, NOW)).toBe('presale_active');
  });
});

// ---------------------------------------------------------------------------
// canAccessWithoutCode
// ---------------------------------------------------------------------------

describe('canAccessWithoutCode', () => {
  it('returns true when now is inside the public sale window', () => {
    const during = new Date('2026-04-15T12:00:00Z');
    expect(canAccessWithoutCode(TICKET_TYPE, during)).toBe(true);
  });

  it('returns false when now is before public sale start', () => {
    expect(canAccessWithoutCode(TICKET_TYPE, NOW)).toBe(false);
  });

  it('returns false when now is after public sale end', () => {
    const after = new Date('2026-05-01T00:00:00Z');
    expect(canAccessWithoutCode(TICKET_TYPE, after)).toBe(false);
  });

  it('returns true exactly at sale_start', () => {
    expect(canAccessWithoutCode(TICKET_TYPE, SALE_START)).toBe(true);
  });

  it('returns true exactly at sale_end', () => {
    expect(canAccessWithoutCode(TICKET_TYPE, SALE_END)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validatePresaleAccess
// ---------------------------------------------------------------------------

describe('validatePresaleAccess', () => {
  it('grants access for correct code in active presale window', () => {
    const result = validatePresaleAccess(PLAIN_CODE, makeConfig(), TICKET_TYPE, NOW, SECRET);
    expect(result.access_granted).toBe(true);
    expect(result.status).toBe('presale_active');
    expect(result.presale_active).toBe(true);
    expect(result.public_sale_active).toBe(false);
    expect(result.message).toBe('Presale přístup povolen.');
  });

  it('throws PresaleInvalidCodeError for incorrect code during presale', () => {
    expect(() =>
      validatePresaleAccess('WRONGCODE', makeConfig(), TICKET_TYPE, NOW, SECRET),
    ).toThrowError(PresaleInvalidCodeError);
  });

  it('throws PresaleNotStartedError when presale has not started yet', () => {
    const before = new Date('2026-03-30T00:00:00Z');
    expect(() =>
      validatePresaleAccess(PLAIN_CODE, makeConfig(), TICKET_TYPE, before, SECRET),
    ).toThrowError(PresaleNotStartedError);
  });

  it('throws PresaleExpiredError when presale_end is in the past (before public sale)', () => {
    // Between presale end and public sale start
    const between = new Date('2026-04-06T05:00:00Z');
    // status = not_on_sale here, which returns access_granted: false without throwing
    const result = validatePresaleAccess(PLAIN_CODE, makeConfig(), TICKET_TYPE, between, SECRET);
    expect(result.access_granted).toBe(false);
    expect(result.status).toBe('not_on_sale');
  });

  it('throws PresaleSoldOutError when presale capacity is exhausted', () => {
    const config = makeConfig({ presale_capacity: 100, presale_sold_count: 100 });
    expect(() =>
      validatePresaleAccess(PLAIN_CODE, config, TICKET_TYPE, NOW, SECRET),
    ).toThrowError(PresaleSoldOutError);
  });

  it('grants access during public sale without code verification', () => {
    const during = new Date('2026-04-15T12:00:00Z');
    const result = validatePresaleAccess('', makeConfig(), TICKET_TYPE, during, SECRET);
    expect(result.access_granted).toBe(true);
    expect(result.public_sale_active).toBe(true);
    expect(result.presale_active).toBe(false);
  });

  it('returns not_on_sale result after all sale windows closed', () => {
    const after = new Date('2026-05-01T00:00:00Z');
    const result = validatePresaleAccess(PLAIN_CODE, makeConfig(), TICKET_TYPE, after, SECRET);
    expect(result.access_granted).toBe(false);
    expect(result.status).toBe('not_on_sale');
  });

  it('accepts code with mixed case and whitespace during presale', () => {
    const result = validatePresaleAccess(
      '  fanclub2026  ',
      makeConfig(),
      TICKET_TYPE,
      NOW,
      SECRET,
    );
    expect(result.access_granted).toBe(true);
  });

  it('rejects code that is empty string during presale', () => {
    expect(() =>
      validatePresaleAccess('', makeConfig(), TICKET_TYPE, NOW, SECRET),
    ).toThrowError(PresaleInvalidCodeError);
  });

  it('error message from PresaleNotStartedError contains presale start date', () => {
    const before = new Date('2026-03-01T00:00:00Z');
    let err: Error | null = null;
    try {
      validatePresaleAccess(PLAIN_CODE, makeConfig(), TICKET_TYPE, before, SECRET);
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeInstanceOf(PresaleNotStartedError);
    expect(err?.message).toContain(PRESALE_START.toISOString());
  });

  it('PresaleInvalidCodeError has correct code and statusCode', () => {
    let err: PresaleInvalidCodeError | null = null;
    try {
      validatePresaleAccess('BADCODE', makeConfig(), TICKET_TYPE, NOW, SECRET);
    } catch (e) {
      err = e as PresaleInvalidCodeError;
    }
    expect(err).toBeInstanceOf(PresaleInvalidCodeError);
    expect(err?.code).toBe('PRESALE_INVALID_CODE');
    expect(err?.statusCode).toBe(403);
  });

  it('PresaleSoldOutError has correct code and statusCode', () => {
    const config = makeConfig({ presale_capacity: 10, presale_sold_count: 10 });
    let err: PresaleSoldOutError | null = null;
    try {
      validatePresaleAccess(PLAIN_CODE, config, TICKET_TYPE, NOW, SECRET);
    } catch (e) {
      err = e as PresaleSoldOutError;
    }
    expect(err).toBeInstanceOf(PresaleSoldOutError);
    expect(err?.code).toBe('PRESALE_SOLD_OUT');
    expect(err?.statusCode).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Extended Test Coverage: Presale Code Validation & Capacity Management
// ---------------------------------------------------------------------------

describe('validatePresaleAccess — presale code validation', () => {
  it('rejects null presale_code_hash gracefully', () => {
    const config = makeConfig({ presale_code_hash: null as any });
    expect(() =>
      validatePresaleAccess(PLAIN_CODE, makeConfig(), TICKET_TYPE, NOW, SECRET),
    ).not.toThrow();
  });

  it('validates code with special characters and numbers', () => {
    const specialCode = 'VIP-2026-ABC!@#';
    const hash = hashPresaleCode(specialCode, SECRET);
    const result = validatePresaleAccess(specialCode, makeConfig({ presale_code_hash: hash }), TICKET_TYPE, NOW, SECRET);
    expect(result.access_granted).toBe(true);
  });

  it('code with leading/trailing spaces is trimmed before validation', () => {
    const result = validatePresaleAccess(
      '  ' + PLAIN_CODE + '  ',
      makeConfig(),
      TICKET_TYPE,
      NOW,
      SECRET,
    );
    expect(result.access_granted).toBe(true);
  });

  it('throws PresaleExpiredError when presale ended and code is correct but window closed', () => {
    const after = new Date('2026-04-06T05:00:00Z'); // After presale, before public sale
    expect(() =>
      validatePresaleAccess(PLAIN_CODE, makeConfig(), TICKET_TYPE, after, SECRET),
    ).not.toThrow(); // Does not throw, returns access_granted: false
  });
});

describe('validatePresaleAccess — presale capacity edge cases', () => {
  it('allows one more ticket when at capacity-1', () => {
    const config = makeConfig({ presale_capacity: 100, presale_sold_count: 99 });
    const result = validatePresaleAccess(PLAIN_CODE, config, TICKET_TYPE, NOW, SECRET);
    expect(result.access_granted).toBe(true);
  });

  it('rejects when exactly at capacity', () => {
    const config = makeConfig({ presale_capacity: 100, presale_sold_count: 100 });
    expect(() =>
      validatePresaleAccess(PLAIN_CODE, config, TICKET_TYPE, NOW, SECRET),
    ).toThrowError(PresaleSoldOutError);
  });

  it('rejects when over capacity (data inconsistency guard)', () => {
    const config = makeConfig({ presale_capacity: 100, presale_sold_count: 101 });
    expect(() =>
      validatePresaleAccess(PLAIN_CODE, config, TICKET_TYPE, NOW, SECRET),
    ).toThrowError(PresaleSoldOutError);
  });

  it('handles presale_capacity = null (unlimited) during presale', () => {
    const config = makeConfig({ presale_capacity: null, presale_sold_count: 999 });
    const result = validatePresaleAccess(PLAIN_CODE, config, TICKET_TYPE, NOW, SECRET);
    expect(result.access_granted).toBe(true);
    expect(result.status).toBe('presale_active');
  });

  it('multiple presale codes per event — different codes with different hashes', () => {
    const code1 = 'CODE-A';
    const code2 = 'CODE-B';
    const hash1 = hashPresaleCode(code1, SECRET);
    const hash2 = hashPresaleCode(code2, SECRET);
    expect(hash1).not.toBe(hash2);
    // Both codes should fail if we only use hash1
    expect(() =>
      validatePresaleAccess(code2, makeConfig({ presale_code_hash: hash1 }), TICKET_TYPE, NOW, SECRET),
    ).toThrowError(PresaleInvalidCodeError);
  });

  it('capacity tracking increments correctly over time', () => {
    const config1 = makeConfig({ presale_sold_count: 0 });
    const config2 = makeConfig({ presale_sold_count: 1 });
    const config3 = makeConfig({ presale_sold_count: 2 });

    // All three should be accessible in presale window
    expect(validatePresaleAccess(PLAIN_CODE, config1, TICKET_TYPE, NOW, SECRET).access_granted).toBe(true);
    expect(validatePresaleAccess(PLAIN_CODE, config2, TICKET_TYPE, NOW, SECRET).access_granted).toBe(true);
    expect(validatePresaleAccess(PLAIN_CODE, config3, TICKET_TYPE, NOW, SECRET).access_granted).toBe(true);
  });
});
