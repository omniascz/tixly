import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../lib/service-container.js';
import { errorResponse } from '../../../../lib/route-helpers.js';
import { ConsentError } from '../../../../lib/consent-errors.js';
import { revokeAllConsents } from '../../../../services/consent-api.service.js';

/**
 * POST /api/consent/revoke-all
 * Revoke all consents for user (GDPR right to withdraw).
 * Body: { reason?: string }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const userId = req.headers.get('x-user-id');
    if (!userId) {
      throw new ConsentError('UNAUTHORIZED', 'User ID required');
    }

    let body: { reason?: string } = {};
    try {
      body = await req.json();
    } catch {
      // Empty body is allowed
    }

    const { reason } = body;

    const deps = getServiceDeps();
    const ipAddress = req.headers.get('x-forwarded-for') ?? req.ip ?? null;

    const result = await revokeAllConsents(userId, reason ?? null, ipAddress, deps);

    return NextResponse.json(
      {
        data: {
          revokedCount: result.revokedCount,
          timestamp: result.timestamp.toISOString(),
        },
      },
      { status: 200 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
