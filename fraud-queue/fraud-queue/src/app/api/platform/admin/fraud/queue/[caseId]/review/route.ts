import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { reviewFraudCase } from '../../../../../../../../services/fraud-queue.service';
import { isFraudError } from '../../../../../../../../lib/fraud-errors';
import type { FraudDeps, ReviewDecision } from '../../../../../../../../services/fraud-queue.service';

function requireAdminUserId(request: NextRequest): string | null {
  return request.headers.get('x-admin-user-id');
}

const ReviewSchema = z.object({
  decision: z.enum(['clear', 'confirm_fraud', 'escalate', 'add_note']),
  notes:    z.string().max(2000).optional(),
  banBuyer: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// POST /api/platform/admin/fraud/queue/:caseId/review
//
// Rozhodnutí admina o fraud případu.
//
// Rozhodnutí:
//   clear         — objednávka je legitimní; pokud byla pozdržena, odblokovat
//   confirm_fraud — potvrzený podvod; cancel order; optionally ban buyer
//   escalate      — případ předán senior týmu; priorita → critical
//   add_note      — přidat poznámku bez změny stavu
//
// Poznámky jsou povinné pro confirm_fraud a escalate.
//
// Request body:
// {
//   "decision": "confirm_fraud",
//   "notes": "Série card-testing transakcí ze stejné IP za 8 minut.",
//   "banBuyer": true
// }
//
// Response: 204 No Content
// ---------------------------------------------------------------------------
export async function POST(
  request: NextRequest,
  { params, deps }: { params: { caseId: string }; deps?: FraudDeps },
): Promise<NextResponse> {
  const resolvedDeps = deps ?? getProductionDeps();

  const adminUserId = requireAdminUserId(request);
  if (!adminUserId) {
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

  let input: { decision: ReviewDecision; notes?: string; banBuyer?: boolean };
  try {
    input = ReviewSchema.parse(body);
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
    await reviewFraudCase(params.caseId, adminUserId, input, resolvedDeps);
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
