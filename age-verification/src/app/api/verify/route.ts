// ---------------------------------------------------------------------------
// POST /api/verify — age verification endpoint
//
// Always returns HTTP 200. The `verified` field in the response payload
// indicates whether verification was successful. HTTP errors (4xx/5xx) are reserved
// for genuine infrastructure failures.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  verifyAge,
  validateBirthDate,
  requiresAgeVerification,
} from '../../../services/age-verification.service.js';
import type { DbAdapter } from '../../../lib/types.js';

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const VerifyRequestSchema = z.object({
  orderId: z.string().uuid('orderId must be a valid UUID'),
  birthDate: z.string().refine(
    (date) => /^\d{4}-\d{2}-\d{2}$/.test(date),
    'birthDate must be in YYYY-MM-DD format',
  ),
  method: z.enum(['self_declared', 'bankid']).optional().default('self_declared'),
});

// ---------------------------------------------------------------------------
// Stub DB adapter — replace with your real implementation
// ---------------------------------------------------------------------------

const db = {} as DbAdapter;

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const parsed = VerifyRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Validation error',
        details: parsed.error.flatten(),
        verified: false,
      },
      { status: 400 },
    );
  }

  const { orderId, birthDate, method } = parsed.data;

  try {
    // Check if order exists and requires age verification
    const requires = await requiresAgeVerification(orderId, db);
    if (!requires) {
      return NextResponse.json(
        {
          error: 'Order does not require age verification',
          verified: false,
        },
        { status: 200 },
      );
    }

    // Validate birth date
    const validation = validateBirthDate(birthDate, 18);
    if (!validation.isValid) {
      return NextResponse.json(
        {
          error: 'User does not meet minimum age requirement',
          verified: false,
          required_age: 18,
          user_age: validation.ageYears,
        },
        { status: 200 },
      );
    }

    // Perform age verification
    const verification = await verifyAge(orderId, birthDate, method, db);

    return NextResponse.json(
      {
        id: verification.id,
        orderId: verification.orderId,
        userId: verification.userId,
        ageAtVerification: verification.ageAtVerification,
        verified: true,
        method: verification.method,
        verifiedAt: verification.verifiedAt,
      },
      { status: 200 },
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';

    if (errorMsg.startsWith('VALIDATION_ERROR')) {
      return NextResponse.json(
        {
          error: errorMsg.replace('VALIDATION_ERROR: ', ''),
          verified: false,
        },
        { status: 200 },
      );
    }

    // Unexpected infrastructure error — return safe denial response with HTTP 200
    console.error('[POST /api/verify] Unexpected error:', err);
    return NextResponse.json(
      {
        error: 'Internal server error. Please try again later.',
        verified: false,
      },
      { status: 200 },
    );
  }
}
