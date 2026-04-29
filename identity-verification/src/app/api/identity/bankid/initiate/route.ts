/**
 * GET /api/identity/bankid/initiate
 *
 * Query params:
 *   userId       — UUID of the platform user
 *   redirectAfter — path to redirect after successful verification (default: /dashboard)
 *
 * Returns: { authUrl: string }
 * Frontend should redirect the user to authUrl.
 */

import { NextRequest, NextResponse } from 'next/server';
import { initiateVerification } from '../../../../../services/bankid.service.js';
import type { IdentityDeps } from '../../../../../services/bankid.service.js';

// In a real deployment these are imported from the platform DI container.
// For Next.js route handlers we construct lightweight singletons here.
declare const platformDeps: IdentityDeps;

function getDeps(): IdentityDeps {
  // This thin shim allows the real deps to be provided by the platform.
  // During tests, the route is not called directly — the service is tested.
  if (typeof platformDeps !== 'undefined') return platformDeps;
  throw new Error('Platform deps not configured');
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const userId       = searchParams.get('userId');
  const redirectAfter = searchParams.get('redirectAfter') ?? '/dashboard';

  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  try {
    const deps = getDeps();
    const { authUrl } = await initiateVerification(userId, redirectAfter, deps);

    return NextResponse.json(
      { authUrl },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
