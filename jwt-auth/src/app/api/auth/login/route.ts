import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { LoginBodySchema } from '../../../../lib/zod-schemas';
import { login } from '../../../../services/auth.service';
import { AuthError } from '../../../../lib/auth-errors';
import type { ServiceDeps } from '../../../../lib/service-container';

// NOTE: In production, inject a real PostgreSQL DbAdapter (e.g. via edge-compatible postgres.js).
// The deps object is exported for testability / dependency injection.
function getDeps(): ServiceDeps {
  throw new Error(
    'getDeps() must be replaced with a real DbAdapter before deploying. ' +
    'Import and call createDbAdapter() from your infrastructure layer.'
  );
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

  let parsed: { email: string; password: string };
  try {
    parsed = LoginBodySchema.parse(body);
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
    const tokenPair = await login(parsed.email, parsed.password, deps);
    return NextResponse.json(tokenPair, { status: 200 });
  } catch (err) {
    if (err instanceof AuthError) {
      // Normalize to INVALID_CREDENTIALS for security (don't leak user existence)
      if (err.code === 'USER_NOT_FOUND') {
        return NextResponse.json(
          { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } },
          { status: 401 }
        );
      }
      return err.toResponse();
    }
    console.error('[login] Unexpected error:', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } },
      { status: 500 }
    );
  }
}
