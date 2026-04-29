import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { PaginationSchema } from '../../../../../../lib/zod-schemas';
import { adminListPendingKyc } from '../../../../../../services/onboarding.service';
import { isOnboardingError } from '../../../../../../lib/onboarding-errors';
import type { ServiceDeps } from '../../../../../../lib/service-container';
import { getServiceDeps } from '../../../../../../lib/service-container.js';

function requireAdminUserId(request: NextRequest): string | null {
  return request.headers.get('x-admin-user-id');
}

export async function GET(
  request: NextRequest,
  context?: { deps?: ServiceDeps },
): Promise<NextResponse> {
  const deps: ServiceDeps = context?.deps ?? getServiceDeps();

  const adminUserId = requireAdminUserId(request);
  if (!adminUserId) {
    return NextResponse.json(
      { error: 'UNAUTHORIZED', message: 'Admin authentication required' },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  let pagination: { limit: number; offset: number };
  try {
    pagination = PaginationSchema.parse({
      limit: searchParams.get('limit') ?? undefined,
      offset: searchParams.get('offset') ?? undefined,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Invalid query parameters', details: err.errors },
        { status: 400 },
      );
    }
    throw err;
  }

  try {
    const result = await adminListPendingKyc(pagination, deps);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (isOnboardingError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}

