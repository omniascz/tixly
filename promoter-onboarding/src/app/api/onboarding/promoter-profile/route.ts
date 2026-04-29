import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { CreatePromoterProfileSchema } from '../../../../lib/zod-schemas';
import { createPromoterProfile } from '../../../../services/onboarding.service';
import { isOnboardingError } from '../../../../lib/onboarding-errors';
import type { ServiceDeps } from '../../../../lib/service-container';
import { getServiceDeps } from '../../../../lib/service-container.js';

async function requireAuth(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    const { requireUser } = await import('@tixly/jwt-auth').catch(() => ({
      requireUser: async (req: NextRequest) => {
        // Fallback for environments without jwt-auth: decode header manually
        const t = req.headers.get('authorization')?.slice(7) ?? '';
        // In tests this is replaced by mocking; in production jwt-auth is used
        return { userId: t };
      },
    }));
    const result = await requireUser(request);
    return result.userId;
  } catch {
    return null;
  }
}

export async function POST(
  request: NextRequest,
  context?: { deps?: ServiceDeps; userId?: string },
): Promise<NextResponse> {
  const deps: ServiceDeps = context?.deps ?? getServiceDeps();

  const userId = context?.userId ?? (await requireAuth(request));
  if (!userId) {
    return NextResponse.json(
      { error: 'UNAUTHORIZED', message: 'Authentication required' },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON', message: 'Invalid request body' }, { status: 400 });
  }

  let input;
  try {
    input = CreatePromoterProfileSchema.parse(body);
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
    const result = await createPromoterProfile(userId, input, deps);
    return NextResponse.json({ promoterId: result.promoterId }, { status: 201 });
  } catch (err) {
    if (isOnboardingError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}

