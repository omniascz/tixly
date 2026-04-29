/**
 * GET /api/attribution/[eventId]/performance
 *
 * Returns channel performance data for a specific event within a date range.
 * Requires promoter authentication (x-user-id and x-promoter-id headers).
 *
 * Query params:
 *   from    — ISO 8601 date string (required)
 *   to      — ISO 8601 date string (required)
 *   model?  — 'first_click' | 'last_click' | 'linear'  (default: 'last_click')
 *
 * Response 200: ChannelPerformance[]  (sorted by attributedRevenue DESC)
 * Response 400: missing/invalid query params
 * Response 401: missing promoter authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { getChannelPerformance } from '../../../../../services/attribution.service';
import type { ServiceDeps, AttributedConversionRow } from '../../../../../services/attribution.service';
import type { AttributionModel, ChannelPerformance } from '../../../../../types/attribution.types';

// ---------------------------------------------------------------------------
// Service deps stub
// ---------------------------------------------------------------------------

function getServiceDeps(): ServiceDeps {
  throw new Error(
    'getServiceDeps() must be wired to real adapters before deploying.',
  );
}

// ---------------------------------------------------------------------------
// Model validation
// ---------------------------------------------------------------------------

const VALID_MODELS: AttributionModel[] = ['first_click', 'last_click', 'linear'];

function isValidModel(value: string): value is AttributionModel {
  return (VALID_MODELS as string[]).includes(value);
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: { eventId: string } },
): Promise<NextResponse> {
  const { eventId } = params;

  // ── Authentication ──────────────────────────────────────────────────────
  const promoterId = request.headers.get('x-promoter-id');
  const userId = request.headers.get('x-user-id');

  if (!promoterId || !userId) {
    return NextResponse.json(
      {
        error: 'Unauthorized. Provide x-user-id and x-promoter-id headers.',
        code: 'UNAUTHORIZED',
      },
      { status: 401 },
    );
  }

  // ── Query params ────────────────────────────────────────────────────────
  const { searchParams } = request.nextUrl;

  const fromStr = searchParams.get('from');
  const toStr = searchParams.get('to');
  const modelStr = searchParams.get('model') ?? 'last_click';

  if (!fromStr || !toStr) {
    return NextResponse.json(
      {
        error: 'Query params "from" and "to" (ISO 8601) are required.',
        code: 'VALIDATION_ERROR',
      },
      { status: 400 },
    );
  }

  const from = new Date(fromStr);
  const to = new Date(toStr);

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json(
      {
        error: '"from" and "to" must be valid ISO 8601 date strings.',
        code: 'VALIDATION_ERROR',
      },
      { status: 400 },
    );
  }

  if (from >= to) {
    return NextResponse.json(
      {
        error: '"from" must be earlier than "to".',
        code: 'VALIDATION_ERROR',
      },
      { status: 400 },
    );
  }

  if (!isValidModel(modelStr)) {
    return NextResponse.json(
      {
        error: `"model" must be one of: ${VALID_MODELS.join(', ')}.`,
        code: 'VALIDATION_ERROR',
      },
      { status: 400 },
    );
  }

  const model: AttributionModel = modelStr;

  // ── Service call ────────────────────────────────────────────────────────
  let deps: ServiceDeps;
  try {
    deps = getServiceDeps();
  } catch (err) {
    console.error('[GET /api/attribution/[eventId]/performance] service init error:', err);
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }

  try {
    const performance: ChannelPerformance[] = await getChannelPerformance(
      deps,
      promoterId,
      eventId,
      from,
      to,
      model,
    );

    return NextResponse.json(performance, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('[GET /api/attribution/[eventId]/performance] error:', err);
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
