import { NextRequest, NextResponse } from 'next/server';
import { HoldbackService } from '../../../../../services/holdback.service';
import { toHoldbackHttpError } from '../../../../../types/holdback.types';
import type { HoldbackDbAdapter } from '../../../../../services/holdback.service';

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

function getDbAdapter(): HoldbackDbAdapter {
  throw new Error('DB adapter not configured — wire up via getServiceContainer()');
}

// ---------------------------------------------------------------------------
// Rate-limit store (in-memory; replace with Redis in production)
//
// Tracks request counts per IP in a sliding 1-minute window.
// Production: use Redis with INCR + EXPIRE or a sliding-window Lua script.
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number;
  windowStart: number; // Unix timestamp ms
}

const rateLimitStore = new Map<string, RateLimitEntry>();
const RATE_LIMIT_MAX = 10;          // requests
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

function checkRateLimit(ip: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (entry === undefined || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    // New window
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    const retryAfterMs = RATE_LIMIT_WINDOW_MS - (now - entry.windowStart);
    return { allowed: false, retryAfterMs };
  }

  entry.count++;
  return { allowed: true, retryAfterMs: 0 };
}

// Periodically purge stale entries to avoid unbounded memory growth.
// In production this is handled by Redis TTL.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore) {
    if (now - entry.windowStart >= RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitStore.delete(ip);
    }
  }
}, 5 * 60_000); // every 5 minutes

// ---------------------------------------------------------------------------
// POST /api/ticket-types/[ticketTypeId]/access
// Public endpoint — no auth required.
// Validates whether an access code unlocks holdback tickets for this type.
//
// Body:
//   accessCode  string  required
//
// Response:
//   { valid: boolean, unlocksTickets: number }
//
// Rate limit: 10 requests per minute per IP (brute-force protection).
// The access code is validated server-side only — never echoed in error msgs.
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: { ticketTypeId: string } },
): Promise<NextResponse> {
  // --- Rate limiting ---
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';

  const { allowed, retryAfterMs } = checkRateLimit(ip);

  if (!allowed) {
    return NextResponse.json(
      {
        error: 'Too many access code attempts. Please try again later.',
        code: 'RATE_LIMITED',
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil(retryAfterMs / 1000)),
          'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
          'X-RateLimit-Remaining': '0',
        },
      },
    );
  }

  // --- Parse body ---
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', code: 'BAD_REQUEST' },
      { status: 400 },
    );
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json(
      { error: 'Request body must be a JSON object', code: 'BAD_REQUEST' },
      { status: 400 },
    );
  }

  const b = body as Record<string, unknown>;
  const accessCode = b['accessCode'];

  if (typeof accessCode !== 'string' || accessCode.trim() === '') {
    return NextResponse.json(
      { error: 'accessCode is required', code: 'BAD_REQUEST' },
      { status: 400 },
    );
  }

  // --- Validate code ---
  // Constant-time validation is handled inside validateAccessCode via DB query.
  // We always return the same shape regardless of validity to prevent timing attacks.
  try {
    const service = new HoldbackService(getDbAdapter());
    const result = await service.validateAccessCode(
      params.ticketTypeId,
      accessCode.trim(),
    );

    // Always 200 — valid/invalid is in the body, not the status code.
    // This prevents enumeration via HTTP status differences.
    return NextResponse.json(
      {
        valid: result.valid,
        unlocksTickets: result.unlocksTickets,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
          // Discourage caching of validation results
          Pragma: 'no-cache',
        },
      },
    );
  } catch (err) {
    const { status, body: errBody } = toHoldbackHttpError(err);
    return NextResponse.json(errBody, { status });
  }
}
