import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { PresaleService } from '../../../../services/presale.service.js';
import { PresaleError, DEFAULT_LOCAL_EVENT_GEOFENCE } from '../../../../types/presale.types.js';
import type { PresaleDbAdapter } from '../../../../services/presale.service.js';

// ---------------------------------------------------------------------------
// DB adapter factory — wire up at the infrastructure layer
// ---------------------------------------------------------------------------

function getDbAdapter(): PresaleDbAdapter {
  throw new Error('DB adapter not configured — wire up via getServiceContainer()');
}

// ---------------------------------------------------------------------------
// Rate-limit store (in-memory sliding window; use Redis in production)
//
// 10 requests per minute per IP. Always returns HTTP 200 on validation
// attempts — valid/invalid state lives in the response body, not the status
// code, to prevent enumeration of valid codes via HTTP status differences.
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number;
  windowStart: number; // Unix ms
}

const rateLimitStore = new Map<string, RateLimitEntry>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

function checkRateLimit(ip: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (entry === undefined || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
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

// Purge stale entries to prevent unbounded memory growth.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore) {
    if (now - entry.windowStart >= RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitStore.delete(ip);
    }
  }
}, 5 * 60_000);

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const ValidateBodySchema = z.object({
  ticket_type_id: z.string().min(1, 'ticket_type_id je povinné'),
  code: z.string().min(1, 'code je povinné'),
});

// ---------------------------------------------------------------------------
// POST /api/presale/validate
//
// Public endpoint — no authentication required.
// Rate-limited: 10 requests/minute per IP.
//
// Always returns HTTP 200. The `access_granted` flag in the body determines
// whether access was granted. This prevents timing or status-code enumeration.
//
// Body:   { "ticket_type_id": "...", "code": "FANCLUB2026" }
// Response: PresaleValidationResult
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  // --- Rate limiting ---
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';

  const { allowed, retryAfterMs } = checkRateLimit(ip);

  if (!allowed) {
    return NextResponse.json(
      {
        error: 'Příliš mnoho pokusů. Zkuste to znovu za chvíli.',
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

  // --- Parse + validate body ---
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Neplatné JSON tělo požadavku', code: 'BAD_REQUEST' },
      { status: 400 },
    );
  }

  const parsed = ValidateBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.errors[0]?.message ?? 'Neplatný požadavek',
        code: 'BAD_REQUEST',
      },
      { status: 400 },
    );
  }

  const { ticket_type_id, code } = parsed.data;

  // --- Validate presale access ---
  // Always return 200 — errors map to access_granted: false in the body.
  try {
    const service = new PresaleService();
    // Pass request headers and default geofence config for local events
    const result = await service.validateAccess(
      ticket_type_id,
      code,
      getDbAdapter(),
      new Date(),
      request.headers,
      DEFAULT_LOCAL_EVENT_GEOFENCE,
    );

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      },
    });
  } catch (err) {
    // Typed presale errors: return 200 with access_granted: false
    // so that HTTP status codes cannot be used to enumerate valid codes.
    if (err instanceof PresaleError) {
      return NextResponse.json(
        {
          status: 'error',
          access_granted: false,
          presale_active: false,
          public_sale_active: false,
          message: err.message,
        },
        {
          // Intentionally 200 — see module docstring above
          status: 200,
          headers: {
            'Cache-Control': 'no-store',
            Pragma: 'no-cache',
          },
        },
      );
    }

    // Unexpected error — log server-side, return generic 500
    console.error('[presale/validate] Unhandled error:', err);
    return NextResponse.json(
      { error: 'Interní chyba serveru', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
