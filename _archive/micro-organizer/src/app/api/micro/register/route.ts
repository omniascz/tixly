import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { RegisterMicroOrganizerSchema } from '../../../../lib/zod-schemas.js';
import { registerMicroOrganizer } from '../../../../services/micro-organizer.service.js';
import { isMicroOrganizerError } from '../../../../lib/micro-organizer-errors.js';
import { getServiceDeps } from '../../../../lib/service-container.js';
import type { ServiceDeps } from '../../../../lib/service-container.js';

// Rate limit: 5 požadavků za hodinu na IP adresu
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

async function getRateLimitKey(request: NextRequest): Promise<string> {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0]!.trim() : 'unknown';
  return `ratelimit:micro:register:${ip}`;
}

// deps je injektován pro testovatelnost; produkce používá getServiceDeps()
export async function POST(
  request: NextRequest,
  context?: { deps?: ServiceDeps },
): Promise<NextResponse> {
  const deps: ServiceDeps = context?.deps ?? getServiceDeps();

  // Kontrola rate limitu
  const rateLimitKey = await getRateLimitKey(request);
  const currentCount = await deps.redis.get(rateLimitKey);
  if (currentCount !== null && parseInt(currentCount, 10) >= RATE_LIMIT_MAX) {
    return NextResponse.json(
      { error: 'RATE_LIMIT_EXCEEDED', message: 'Příliš mnoho požadavků. Zkuste to prosím za hodinu.' },
      { status: 429 },
    );
  }
  const newCount = currentCount === null ? 1 : parseInt(currentCount, 10) + 1;
  await deps.redis.setex(rateLimitKey, RATE_LIMIT_WINDOW_SECONDS, String(newCount));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'INVALID_JSON', message: 'Neplatné tělo požadavku.' },
      { status: 400 },
    );
  }

  let input;
  try {
    input = RegisterMicroOrganizerSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Neplatný vstup.', details: err.errors },
        { status: 400 },
      );
    }
    throw err;
  }

  try {
    const result = await registerMicroOrganizer(input, deps);
    return NextResponse.json(
      { organizerId: result.organizerId, message: 'Ověřovací e-mail byl odeslán.' },
      { status: 201 },
    );
  } catch (err) {
    if (isMicroOrganizerError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}
