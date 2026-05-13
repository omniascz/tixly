// POST /api/loyalty/redeem — uplatnění věrnostních bodů.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { redeemPoints } from '../../../../services/loyalty.service';
import {
  InsufficientPointsError,
  InvalidRedemptionError,
} from '../../../../types/loyalty.types';
import { getDb } from '../../../../lib/db';
import { getKafka } from '../../../../lib/kafka';

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const RedeemSchema = z.object({
  points: z.number().int().positive({ message: 'Počet bodů musí být kladné celé číslo.' }),
  option: z.enum(['discount', 'free_ticket']),
});

// ---------------------------------------------------------------------------
// POST /api/loyalty/redeem
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Neplatné JSON tělo požadavku.', code: 'BAD_REQUEST' },
      { status: 400 },
    );
  }

  const parsed = RedeemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Validace selhala.',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      },
      { status: 422 },
    );
  }

  const { points, option } = parsed.data;

  try {
    const result = await redeemPoints(
      { db: getDb(), kafka: getKafka() },
      userId,
      points,
      option,
    );

    return NextResponse.json({ data: result });
  } catch (err) {
    if (err instanceof InsufficientPointsError) {
      return NextResponse.json(
        {
          error: err.message,
          code: 'INSUFFICIENT_POINTS',
          available: err.available,
          required: err.required,
        },
        { status: 422 },
      );
    }

    if (err instanceof InvalidRedemptionError) {
      return NextResponse.json(
        { error: err.message, code: 'INVALID_REDEMPTION' },
        { status: 422 },
      );
    }

    const message = err instanceof Error ? err.message : 'Interní chyba serveru';
    return NextResponse.json(
      { error: message, code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
