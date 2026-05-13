/**
 * GET /api/identity/status
 *
 * Query params:
 *   userId — UUID of the platform user
 *
 * Returns: VerificationStatus
 */

import { NextRequest, NextResponse } from 'next/server';
import { getVerificationStatus } from '../../../../services/bankid.service.js';
import type { IdentityDeps } from '../../../../services/bankid.service.js';

declare const platformDeps: IdentityDeps;

function getDeps(): IdentityDeps {
  if (typeof platformDeps !== 'undefined') return platformDeps;
  throw new Error('Platform deps not configured');
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const userId = searchParams.get('userId');

  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  try {
    const deps   = getDeps();
    const status = await getVerificationStatus(userId, deps);

    return NextResponse.json(status, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
