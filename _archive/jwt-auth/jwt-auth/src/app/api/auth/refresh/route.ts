import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { RefreshBodySchema } from '../../../../lib/zod-schemas';
import { refresh } from '../../../../services/auth.service';
import { AuthError } from '../../../../lib/auth-errors';
import type { ServiceDeps } from '../../../../lib/service-container';

function getDeps(): ServiceDeps {
  throw new Error('getDeps() must be replaced with a real DbAdapter before deploying.');
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } },
      { status: 400 }
    );
  }

  let parsed: { refreshToken: string };
  try {
    parsed = RefreshBodySchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: err.errors[0]?.message ?? 'Invalid input' } },
        { status: 400 }
      );
    }
    throw err;
  }

  try {
    const deps = getDeps();
    const tokenPair = await refresh(parsed.refreshToken, deps);
    return NextResponse.json(tokenPair, { status: 200 });
  } catch (err) {
    if (err instanceof AuthError) {
      return err.toResponse();
    }
    console.error('[refresh] Unexpected error:', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } },
      { status: 500 }
    );
  }
}
