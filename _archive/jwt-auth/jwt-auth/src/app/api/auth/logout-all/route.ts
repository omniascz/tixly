import { NextRequest, NextResponse } from 'next/server';
import { logoutAll } from '../../../../services/auth.service';
import { requireUser } from '../../../../lib/auth-helpers';
import { AuthError } from '../../../../lib/auth-errors';
import type { ServiceDeps } from '../../../../lib/service-container';

function getDeps(): ServiceDeps {
  throw new Error('getDeps() must be replaced with a real DbAdapter before deploying.');
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { userId } = await requireUser(request);
    const deps = getDeps();
    await logoutAll(userId, deps);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof AuthError) {
      return err.toResponse();
    }
    console.error('[logout-all] Unexpected error:', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } },
      { status: 500 }
    );
  }
}
