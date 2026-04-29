import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { RegisterUserSchema } from '../../../../lib/zod-schemas';
import { registerUser } from '../../../../services/onboarding.service';
import { isOnboardingError } from '../../../../lib/onboarding-errors';
import type { ServiceDeps } from '../../../../lib/service-container';
import { getServiceDeps } from '../../../../lib/service-container.js';

// Rate limit: 5 requests per hour per IP
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

async function getRateLimitKey(request: NextRequest): Promise<string> {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : 'unknown';
  return `ratelimit:register:${ip}`;
}

// deps is injected for testability; production uses getProductionDeps()
export async function POST(
  request: NextRequest,
  context?: { deps?: ServiceDeps },
): Promise<NextResponse> {
  // Resolve dependencies (production: real adapters; tests: mocked)
  const deps: ServiceDeps = context?.deps ?? getServiceDeps();

  // Rate limit check
  const rateLimitKey = await getRateLimitKey(request);
  const currentCount = await deps.redis.get(rateLimitKey);
  if (currentCount !== null && parseInt(currentCount, 10) >= RATE_LIMIT_MAX) {
    return NextResponse.json(
      { error: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Please try again later.' },
      { status: 429 },
    );
  }
  const newCount = currentCount === null ? 1 : parseInt(currentCount, 10) + 1;
  await deps.redis.setex(rateLimitKey, RATE_LIMIT_WINDOW_SECONDS, String(newCount));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON', message: 'Invalid request body' }, { status: 400 });
  }

  let input;
  try {
    input = RegisterUserSchema.parse(body);
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
    const result = await registerUser(input, deps);
    return NextResponse.json(
      { userId: result.userId, message: 'Verifikační email odeslán' },
      { status: 201 },
    );
  } catch (err) {
    if (isOnboardingError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}

