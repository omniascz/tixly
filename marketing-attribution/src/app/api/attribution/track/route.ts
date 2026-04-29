/**
 * POST /api/attribution/track
 *
 * Public endpoint — no authentication required.
 * Records a marketing touch point for a user session.
 *
 * Request body:
 *   {
 *     sessionId: string          (required)
 *     userId?: string
 *     eventId?: string
 *     url?: string               — page URL; UTM params are extracted here
 *     referrer?: string | null
 *   }
 *
 * Response 201: { touchPointId: string; channel: string }
 * Response 400: validation error
 */

import { NextRequest, NextResponse } from 'next/server';
import { parseUtmParams, deriveChannel } from '../../../../lib/utm-parser';
import { trackTouchPoint } from '../../../../services/attribution.service';
import type { ServiceDeps } from '../../../../services/attribution.service';

// ---------------------------------------------------------------------------
// DB / EventBus stubs — wire to real implementations before deploying
// ---------------------------------------------------------------------------

function getServiceDeps(): ServiceDeps {
  throw new Error(
    'getServiceDeps() must be wired to real adapters before deploying. ' +
    'Import from @tixly/db and @tixly/kafka or inject via middleware.',
  );
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', code: 'INVALID_JSON' },
      { status: 400 },
    );
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json(
      { error: 'Request body must be a JSON object', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

  const raw = body as Record<string, unknown>;

  if (typeof raw['sessionId'] !== 'string' || raw['sessionId'].trim() === '') {
    return NextResponse.json(
      { error: 'sessionId (non-empty string) is required', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

  const sessionId = raw['sessionId'] as string;
  const userId = typeof raw['userId'] === 'string' ? raw['userId'] : undefined;
  const eventId = typeof raw['eventId'] === 'string' ? raw['eventId'] : undefined;
  const pageUrl = typeof raw['url'] === 'string' ? raw['url'] : undefined;
  const referrer =
    typeof raw['referrer'] === 'string' ? raw['referrer'] : null;

  // Parse UTM params from the submitted URL (if provided)
  const utmParams = pageUrl ? parseUtmParams(pageUrl) : null;
  const channel = deriveChannel(utmParams ?? {}, referrer);

  let deps: ServiceDeps;
  try {
    deps = getServiceDeps();
  } catch (err) {
    console.error('[POST /api/attribution/track] service init error:', err);
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }

  // Fire-and-forget — we acknowledge immediately and process asynchronously
  trackTouchPoint(deps, {
    sessionId,
    userId,
    eventId,
    utmParams,
    referrer,
    channel,
  });

  return NextResponse.json(
    { accepted: true, channel },
    { status: 202 },
  );
}
