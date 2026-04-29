import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../lib/service-container.js';
import { errorResponse } from '../../../../lib/route-helpers.js';
import { ConsentError } from '../../../../lib/consent-errors.js';
import { getConsentHistory } from '../../../../services/consent-api.service.js';
import type { ConsentType } from '../../../../types/consent.js';

/**
 * GET /api/consent/history
 * Paginated consent audit trail with optional filtering.
 * Query params:
 *   - type?: ConsentType
 *   - startDate?: ISO string
 *   - endDate?: ISO string
 *   - limit?: number (default 50, max 200)
 *   - offset?: number (default 0)
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const userId = req.headers.get('x-user-id');
    if (!userId) {
      throw new ConsentError('UNAUTHORIZED', 'User ID required');
    }

    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') as ConsentType | null;
    const startDate = searchParams.get('startDate') ? new Date(searchParams.get('startDate')!) : undefined;
    const endDate = searchParams.get('endDate') ? new Date(searchParams.get('endDate')!) : undefined;
    let limit = parseInt(searchParams.get('limit') ?? '50', 10);
    let offset = parseInt(searchParams.get('offset') ?? '0', 10);

    // Validate limits
    if (limit < 1 || limit > 200) {
      limit = 50;
    }
    if (offset < 0) {
      offset = 0;
    }

    // Validate type if provided
    const validTypes = ['marketing', 'analytics', 'personalization', 'functional'];
    if (type && !validTypes.includes(type)) {
      throw new ConsentError('INVALID_CONSENT', 'Invalid consent type');
    }

    const deps = getServiceDeps();
    const { entries, total } = await getConsentHistory(
      userId,
      {
        type,
        startDate,
        endDate,
        limit,
        offset,
      },
      deps,
    );

    return NextResponse.json(
      {
        data: entries,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
      },
      { status: 200 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
