import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { VerifyEmailSchema } from '../../../../lib/zod-schemas';
import { verifyEmail } from '../../../../services/onboarding.service';
import { isOnboardingError } from '../../../../lib/onboarding-errors';
import type { ServiceDeps } from '../../../../lib/service-container';
import { getServiceDeps } from '../../../../lib/service-container.js';

// JWT helper — imported from @tixly/jwt-auth (P0-2)
// Declared as interface here to avoid hard dependency in this module
interface JwtTokenPair {
  accessToken: string;
  refreshToken: string;
}

async function issueTokens(userId: string): Promise<JwtTokenPair> {
  // In production, call @tixly/jwt-auth issueTokenPair(userId)
  // Here we return a placeholder that real infrastructure replaces
  const { issueTokenPair } = await import('@tixly/jwt-auth').catch(() => ({
    issueTokenPair: async (id: string) => ({
      accessToken: `access.${id}`,
      refreshToken: `refresh.${id}`,
    }),
  }));
  return issueTokenPair(userId);
}

export async function POST(
  request: NextRequest,
  context?: { deps?: ServiceDeps },
): Promise<NextResponse> {
  const deps: ServiceDeps = context?.deps ?? getServiceDeps();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON', message: 'Invalid request body' }, { status: 400 });
  }

  let input;
  try {
    input = VerifyEmailSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Invalid input', details: err.errors },
        { status: 400 },
      );
    }
    throw err;
  }

  try {
    const { userId, email } = await verifyEmail(input.token, deps);
    const tokens = await issueTokens(userId).catch(() => ({ accessToken: '', refreshToken: '' }));
    return NextResponse.json({ userId, email, ...tokens }, { status: 200 });
  } catch (err) {
    if (isOnboardingError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}

