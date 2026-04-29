/**
 * Exponential backoff retry logic for webhook deliveries.
 *
 * Configurable initial delay, multiplier, and max cap.
 * Shared across all projects.
 */
import type { RetryConfig } from './types.js';
import { DEFAULT_RETRY_CONFIG } from './types.js';

/**
 * Calculate the delay in seconds before the next retry attempt.
 *
 * Formula: min(initialDelay × multiplier^attemptCount, maxDelay)
 *
 * Examples with default config (initial=30s, multiplier=2, max=3600s):
 *   attempt 0: 30s
 *   attempt 1: 60s
 *   attempt 2: 120s
 *   attempt 3: 240s
 *   attempt 4: 480s
 *   attempt 5: 960s
 *   attempt 6: 1920s
 *   attempt 7: 3600s (capped)
 */
export function retryDelaySec(
  attemptCount: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): number {
  const delay = config.initialDelaySec * Math.pow(config.backoffMultiplier, attemptCount);
  return Math.min(delay, config.maxDelaySec);
}

/**
 * Calculate the delay in milliseconds.
 */
export function retryDelayMs(
  attemptCount: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): number {
  return retryDelaySec(attemptCount, config) * 1000;
}

/**
 * Calculate the next retry timestamp (ISO string).
 */
export function nextRetryAt(
  attemptCount: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  now: Date = new Date(),
): string {
  const delayMs = retryDelayMs(attemptCount, config);
  return new Date(now.getTime() + delayMs).toISOString();
}

/**
 * Check if the delivery should be retried or marked as exhausted.
 */
export function shouldRetry(
  attemptCount: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): boolean {
  return attemptCount < config.maxRetries;
}

/**
 * Check if an endpoint should be auto-disabled based on consecutive failure count.
 * Returns false if auto-disable is not configured (threshold = 0).
 */
export function shouldAutoDisable(
  consecutiveFailures: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): boolean {
  if (config.autoDisableThreshold === 0) return false;
  return consecutiveFailures >= config.autoDisableThreshold;
}
