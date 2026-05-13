import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../lib/service-container.js';
import { errorResponse } from '../../../lib/route-helpers.js';
import { ConsentError } from '../../../lib/consent-errors.js';
import { getConsentStatus, updateConsent } from '../../../services/consent-api.service.js';
import type { ConsentStatus, ConsentType } from '../../../types/consent.js';

/**
 * GET /api/consent
 * Returns current consent status for logged-in user.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const userId = req.headers.get('x-user-id');
    if (!userId) {
      throw new ConsentError('UNAUTHORIZED', 'User ID required');
    }

    const deps = getServiceDeps();
    const status = await getConsentStatus(userId, deps);

    return NextResponse.json({ data: status }, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * POST /api/consent
 * Update single consent type with optional reason.
 * Body: { type: ConsentType, status: ConsentStatus, reason?: string }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const userId = req.headers.get('x-user-id');
    if (!userId) {
      throw new ConsentError('UNAUTHORIZED', 'User ID required');
    }

    const body = await req.json() as {
      type?: unknown;
      status?: unknown;
      reason?: string;
    };

    const { type, status, reason } = body;

    if (!type || !status) {
      throw new ConsentError('INVALID_CONSENT', 'Missing type or status');
    }

    // Validate type and status
    const validTypes = ['marketing', 'analytics', 'personalization', 'functional'];
    const validStatuses = ['granted', 'denied', 'withdrawn'];
    if (!validTypes.includes(type as string) || !validStatuses.includes(status as string)) {
      throw new ConsentError('INVALID_CONSENT', 'Invalid type or status value');
    }

    const deps = getServiceDeps();
    const ipAddress = req.headers.get('x-forwarded-for') ?? req.ip ?? null;
    const userAgent = req.headers.get('user-agent');

    const consent = await updateConsent(
      userId,
      type as ConsentType,
      status as ConsentStatus,
      reason ?? null,
      ipAddress,
      userAgent,
      deps,
    );

    return NextResponse.json({ data: consent }, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
