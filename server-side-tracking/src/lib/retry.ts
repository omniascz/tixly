import { TrackingApiError } from '../types/tracking.types.js';
import type { RetryConfig } from '../types/tracking.types.js';

/**
 * Returns true for errors that warrant a retry:
 * - TrackingApiError with 5xx status
 * - Network / connectivity errors (no statusCode)
 * Returns false for 4xx (client errors) — do not retry.
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof TrackingApiError) {
    return error.statusCode >= 500;
  }

  // Network errors: ECONNREFUSED, ETIMEDOUT, fetch failures etc.
  if (error instanceof Error) {
    const networkMessages = [
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNRESET',
      'fetch failed',
      'network',
      'timeout',
    ];
    const msg = error.message.toLowerCase();
    return networkMessages.some((term) => msg.includes(term.toLowerCase()));
  }

  // Unknown errors — assume retryable to be safe
  return true;
}

/**
 * Calculate exponential backoff delay.
 * Formula: baseDelayMs × 2^(attempt - 1)
 * attempt=1 → baseDelayMs, attempt=2 → 2×baseDelayMs, attempt=3 → 4×baseDelayMs
 */
export function calculateDelay(attempt: number, baseDelayMs: number): number {
  return baseDelayMs * Math.pow(2, attempt - 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute fn with retry logic and exponential backoff.
 * Retries only on retryable errors (5xx / network).
 * Throws the last error after maxAttempts are exhausted.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const retryable = isRetryableError(error);
      const hasMoreAttempts = attempt < config.maxAttempts;

      if (!retryable || !hasMoreAttempts) {
        throw error;
      }

      const delay = calculateDelay(attempt, config.baseDelayMs);
      await sleep(delay);
    }
  }

  // Should never reach here, but TypeScript needs the throw
  throw lastError;
}
