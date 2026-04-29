/**
 * GET /api/identity/onfido/status
 *
 * Header: x-user-id — UUID of the platform user
 * Returns: OnfidoVerificationResult | { status: 'none' }
 */

import { NextRequest, NextResponse } from 'next/server';

import { getOnfidoVerificationStatus, type ServiceDeps } from '../../../../../services/onfido.service.js';

declare const platformDeps: ServiceDeps;
function getDeps(): ServiceDeps {
  if (typeof platformDeps !== 'undefined') return platformDeps;
  throw new Error('Platform deps not configured');
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'x-user-id header is required' }, { status: 400 });
  }

  try {
    const deps = getDeps();
    const result = await getOnfidoVerificationStatus(userId, deps);
    if (!result) {
      return NextResponse.json({ status: 'none' }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
