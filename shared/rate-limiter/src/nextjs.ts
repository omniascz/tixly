// =============================================================================
// @tixly/rate-limiter — Next.js middleware helpers
// =============================================================================

import { NextResponse } from 'next/server';
import type { RateLimitConfig, RateLimitResult } from './index.js';

/**
 * Build a 429 Too Many Requests response with standard rate limit headers.
 * Czech error message for user-facing display.
 */
export function rateLimitResponse(result: RateLimitResult, config: RateLimitConfig): NextResponse {
  return new NextResponse(
    JSON.stringify({
      error: {
        code: 'RATE_LIMITED',
        message: 'Příliš mnoho požadavků. Zkuste to znovu později.',
        retryAfter: result.retryAfterSeconds,
      },
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(result.retryAfterSeconds ?? 60),
        'X-RateLimit-Limit': String(config.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': result.resetAt.toISOString(),
      },
    },
  );
}

/**
 * Add rate limit headers to an existing NextResponse.
 * Call this on allowed responses to inform clients of current usage.
 */
export function addRateLimitHeaders(
  response: NextResponse,
  result: RateLimitResult,
  config: RateLimitConfig,
): NextResponse {
  response.headers.set('X-RateLimit-Limit', String(config.limit));
  response.headers.set('X-RateLimit-Remaining', String(result.remaining));
  response.headers.set('X-RateLimit-Reset', result.resetAt.toISOString());
  return response;
}
