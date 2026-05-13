import { describe, it, expect } from 'vitest';
import {
  retryDelaySec,
  retryDelayMs,
  nextRetryAt,
  shouldRetry,
  shouldAutoDisable,
} from './retry.js';
import { DEFAULT_RETRY_CONFIG, type RetryConfig } from './types.js';

// ---------------------------------------------------------------------------
// retryDelaySec
// ---------------------------------------------------------------------------

describe('retryDelaySec', () => {
  it('uses default config (initial=30, mult=2)', () => {
    expect(retryDelaySec(0)).toBe(30);    // 30 × 2^0 = 30
    expect(retryDelaySec(1)).toBe(60);    // 30 × 2^1 = 60
    expect(retryDelaySec(2)).toBe(120);   // 30 × 2^2 = 120
    expect(retryDelaySec(3)).toBe(240);   // 30 × 2^3 = 240
    expect(retryDelaySec(4)).toBe(480);   // 30 × 2^4 = 480
  });

  it('caps at maxDelaySec', () => {
    // With defaults: 30 × 2^7 = 3840, capped at 3600
    expect(retryDelaySec(7)).toBe(3600);
    expect(retryDelaySec(10)).toBe(3600);
    expect(retryDelaySec(100)).toBe(3600);
  });

  it('supports custom config', () => {
    const config: RetryConfig = {
      maxRetries: 3,
      initialDelaySec: 60,
      maxDelaySec: 600,
      backoffMultiplier: 2,
      autoDisableThreshold: 0,
    };
    expect(retryDelaySec(0, config)).toBe(60);   // 60 × 2^0 = 60
    expect(retryDelaySec(1, config)).toBe(120);  // 60 × 2^1 = 120
    expect(retryDelaySec(2, config)).toBe(240);  // 60 × 2^2 = 240
    expect(retryDelaySec(3, config)).toBe(480);  // 60 × 2^3 = 480
    expect(retryDelaySec(4, config)).toBe(600);  // 60 × 2^4 = 960 → capped at 600
  });

  it('handles non-power-of-2 multiplier', () => {
    const config: RetryConfig = {
      maxRetries: 5,
      initialDelaySec: 10,
      maxDelaySec: 1000,
      backoffMultiplier: 3,
      autoDisableThreshold: 0,
    };
    expect(retryDelaySec(0, config)).toBe(10);   // 10 × 3^0 = 10
    expect(retryDelaySec(1, config)).toBe(30);   // 10 × 3^1 = 30
    expect(retryDelaySec(2, config)).toBe(90);   // 10 × 3^2 = 90
    expect(retryDelaySec(3, config)).toBe(270);  // 10 × 3^3 = 270
    expect(retryDelaySec(4, config)).toBe(810);  // 10 × 3^4 = 810
    expect(retryDelaySec(5, config)).toBe(1000); // 10 × 3^5 = 2430 → capped
  });
});

// ---------------------------------------------------------------------------
// retryDelayMs
// ---------------------------------------------------------------------------

describe('retryDelayMs', () => {
  it('returns seconds × 1000', () => {
    expect(retryDelayMs(0)).toBe(30_000);
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(2)).toBe(120_000);
  });
});

// ---------------------------------------------------------------------------
// nextRetryAt
// ---------------------------------------------------------------------------

describe('nextRetryAt', () => {
  it('returns ISO timestamp offset from now', () => {
    const now = new Date('2026-04-12T10:00:00.000Z');
    const result = nextRetryAt(0, DEFAULT_RETRY_CONFIG, now);
    expect(result).toBe('2026-04-12T10:00:30.000Z'); // +30s
  });

  it('respects custom config and now', () => {
    const now = new Date('2026-04-12T12:00:00.000Z');
    const config: RetryConfig = {
      maxRetries: 3,
      initialDelaySec: 60,
      maxDelaySec: 600,
      backoffMultiplier: 2,
      autoDisableThreshold: 0,
    };
    const result = nextRetryAt(1, config, now);
    expect(result).toBe('2026-04-12T12:02:00.000Z'); // +120s
  });
});

// ---------------------------------------------------------------------------
// shouldRetry
// ---------------------------------------------------------------------------

describe('shouldRetry', () => {
  it('returns true when attemptCount < maxRetries', () => {
    expect(shouldRetry(0)).toBe(true);
    expect(shouldRetry(4)).toBe(true);
  });

  it('returns false when attemptCount >= maxRetries', () => {
    expect(shouldRetry(5)).toBe(false);
    expect(shouldRetry(6)).toBe(false);
    expect(shouldRetry(100)).toBe(false);
  });

  it('respects custom maxRetries', () => {
    const config: RetryConfig = { ...DEFAULT_RETRY_CONFIG, maxRetries: 3 };
    expect(shouldRetry(2, config)).toBe(true);
    expect(shouldRetry(3, config)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shouldAutoDisable
// ---------------------------------------------------------------------------

describe('shouldAutoDisable', () => {
  it('returns false when threshold is 0 (disabled)', () => {
    const config: RetryConfig = { ...DEFAULT_RETRY_CONFIG, autoDisableThreshold: 0 };
    expect(shouldAutoDisable(999, config)).toBe(false);
  });

  it('returns true when failures >= threshold', () => {
    expect(shouldAutoDisable(50)).toBe(true);
    expect(shouldAutoDisable(100)).toBe(true);
  });

  it('returns false when failures < threshold', () => {
    expect(shouldAutoDisable(49)).toBe(false);
    expect(shouldAutoDisable(0)).toBe(false);
  });

  it('respects custom threshold', () => {
    const config: RetryConfig = { ...DEFAULT_RETRY_CONFIG, autoDisableThreshold: 10 };
    expect(shouldAutoDisable(9, config)).toBe(false);
    expect(shouldAutoDisable(10, config)).toBe(true);
  });
});
