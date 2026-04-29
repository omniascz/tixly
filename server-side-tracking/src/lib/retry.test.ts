import { describe, it, expect, vi } from 'vitest';
import { withRetry, isRetryableError, calculateDelay } from './retry.js';
import { TrackingApiError, TrackingPlatform } from '../types/tracking.types.js';

// ─── isRetryableError ─────────────────────────────────────────────────────────

describe('isRetryableError', () => {
  it('returns true for TrackingApiError with 500', () => {
    const err = new TrackingApiError('Server Error', 500, TrackingPlatform.Meta);
    expect(isRetryableError(err)).toBe(true);
  });

  it('returns true for TrackingApiError with 503', () => {
    const err = new TrackingApiError('Service Unavailable', 503, TrackingPlatform.TikTok);
    expect(isRetryableError(err)).toBe(true);
  });

  it('returns false for TrackingApiError with 400', () => {
    const err = new TrackingApiError('Bad Request', 400, TrackingPlatform.Meta);
    expect(isRetryableError(err)).toBe(false);
  });

  it('returns false for TrackingApiError with 401', () => {
    const err = new TrackingApiError('Unauthorized', 401, TrackingPlatform.TikTok);
    expect(isRetryableError(err)).toBe(false);
  });

  it('returns false for TrackingApiError with 422', () => {
    const err = new TrackingApiError('Unprocessable', 422, TrackingPlatform.Meta);
    expect(isRetryableError(err)).toBe(false);
  });

  it('returns true for ECONNREFUSED network error', () => {
    expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
  });

  it('returns true for ETIMEDOUT network error', () => {
    expect(isRetryableError(new Error('ETIMEDOUT'))).toBe(true);
  });

  it('returns true for fetch failed error', () => {
    expect(isRetryableError(new Error('fetch failed'))).toBe(true);
  });

  it('returns true for unknown non-Error objects', () => {
    expect(isRetryableError({ message: 'something' })).toBe(true);
  });
});

// ─── calculateDelay ───────────────────────────────────────────────────────────

describe('calculateDelay', () => {
  it('attempt 1 with base 1000ms returns 1000ms', () => {
    expect(calculateDelay(1, 1000)).toBe(1000);
  });

  it('attempt 2 with base 1000ms returns 2000ms', () => {
    expect(calculateDelay(2, 1000)).toBe(2000);
  });

  it('attempt 3 with base 1000ms returns 4000ms', () => {
    expect(calculateDelay(3, 1000)).toBe(4000);
  });

  it('uses provided base delay correctly', () => {
    expect(calculateDelay(1, 500)).toBe(500);
    expect(calculateDelay(2, 500)).toBe(1000);
    expect(calculateDelay(3, 500)).toBe(2000);
  });
});

// ─── withRetry ────────────────────────────────────────────────────────────────

describe('withRetry', () => {
  const config = { maxAttempts: 3, baseDelayMs: 0 }; // baseDelayMs=0 so tests are instant

  it('returns result immediately on first-try success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, config);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx and succeeds on second attempt', async () => {
    const serverError = new TrackingApiError('Server Error', 500, TrackingPlatform.Meta);
    const fn = vi
      .fn()
      .mockRejectedValueOnce(serverError)
      .mockResolvedValue('recovered');

    const result = await withRetry(fn, config);
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 400 client error', async () => {
    const clientError = new TrackingApiError('Bad Request', 400, TrackingPlatform.Meta);
    const fn = vi.fn().mockRejectedValue(clientError);

    await expect(withRetry(fn, config)).rejects.toThrow(TrackingApiError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('exhausts maxAttempts and throws last error', async () => {
    const serverError = new TrackingApiError('Server Error', 500, TrackingPlatform.TikTok);
    const fn = vi.fn().mockRejectedValue(serverError);

    await expect(withRetry(fn, config)).rejects.toThrow(TrackingApiError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('returns value after successful retry on third attempt', async () => {
    const serverError = new TrackingApiError('Gateway Timeout', 504, TrackingPlatform.Meta);
    const fn = vi
      .fn()
      .mockRejectedValueOnce(serverError)
      .mockRejectedValueOnce(serverError)
      .mockResolvedValue('finally');

    const result = await withRetry(fn, config);
    expect(result).toBe('finally');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry on 422 client error', async () => {
    const clientError = new TrackingApiError('Unprocessable', 422, TrackingPlatform.TikTok);
    const fn = vi.fn().mockRejectedValue(clientError);

    await expect(withRetry(fn, config)).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
