import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../lib/service-container.js';
import { errorResponse } from '../../../../lib/route-helpers.js';
import { ConsentError } from '../../../../lib/consent-errors.js';
import { exportConsentData } from '../../../../services/consent-api.service.js';

/**
 * GET /api/consent/export
 * Export all consent data for GDPR Art. 15 subject access request.
 * Returns JSON downloadable as application/json.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const userId = req.headers.get('x-user-id');
    if (!userId) {
      throw new ConsentError('UNAUTHORIZED', 'User ID required');
    }

    const deps = getServiceDeps();
    const exportData = await exportConsentData(userId, deps);

    // Return as downloadable JSON
    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="consent-export-${userId}-${new Date().toISOString().split('T')[0]}.json"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
