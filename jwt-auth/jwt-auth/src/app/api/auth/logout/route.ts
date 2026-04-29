import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { LogoutBodySchema } from '../../../../lib/zod-schemas';
import { logout } from '../../../../services/auth.service';
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
    parsed = LogoutBodySchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: err.errors[0]?.message ?? 'Invalid input' } },
        { status: 400 }
      );
    }
    throw err;
  }

  const deps = getDeps();
  // logout is best-effort — silently ignore invalid tokens
  await logout(parsed.refreshToken, deps);

  return new NextResponse(null, { status: 204 });
}
