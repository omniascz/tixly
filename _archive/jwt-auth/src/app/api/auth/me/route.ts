import { NextRequest, NextResponse } from 'next/server';
import { extractAndVerifyToken } from '../../../../lib/auth-helpers';
import { AuthError } from '../../../../lib/auth-errors';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const payload = await extractAndVerifyToken(request);

    return NextResponse.json({
      userId: payload.sub,
      email: payload.email,
      name: payload.name,
      isAdmin: payload.isAdmin,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return err.toResponse();
    }
    console.error('[me] Unexpected error:', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } },
      { status: 500 }
    );
  }
}
