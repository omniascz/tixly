import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { escalateCase } from '../../../../../../../../services/fraud-queue.service';
import { isFraudError } from '../../../../../../../../lib/fraud-errors';
import type { FraudDeps } from '../../../../../../../../services/fraud-queue.service';

function requireAdminUserId(request: NextRequest): string | null {
  return request.headers.get('x-admin-user-id');
}

const EscalateSchema = z.object({
  reason: z.string().min(5).max(2000),
});

// ---------------------------------------------------------------------------
// POST /api/platform/admin/fraud/queue/:caseId/escalate
//
// Escalate case to senior CS. Sets status=escalated, priority=critical,
// emits Kafka `fraud.case.escalated`.
// ---------------------------------------------------------------------------
export async function POST(
  request: NextRequest,
  { params, deps }: { params: { caseId: string }; deps?: FraudDeps },
): Promise<NextResponse> {
  const resolvedDeps = deps ?? getProductionDeps();

  const csUserId = requireAdminUserId(request);
  if (!csUserId) {
    return NextResponse.json(
      { error: 'UNAUTHORIZED', message: 'Admin authentication required' },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'INVALID_JSON', message: 'Invalid request body' },
      { status: 400 },
    );
  }

  let input: { reason: string };
  try {
    input = EscalateSchema.parse(body);
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
    await escalateCase(params.caseId, input.reason, csUserId, resolvedDeps);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (isFraudError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}

function getProductionDeps(): FraudDeps {
  throw new Error('Production dependencies not configured. Use dependency injection.');
}
