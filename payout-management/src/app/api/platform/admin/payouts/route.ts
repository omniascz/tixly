import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { adminListPayouts } from '../../../../../services/payout.service.js';
import { PayoutError } from '../../../../../lib/payout-errors.js';
import type { ServiceDeps } from '../../../../../lib/service-container.js';
import { getServiceDeps } from '../../../../../lib/service-container.js';

const QuerySchema = z.object({
  promoterId: z.string().uuid().optional(),
  status: z.enum(['pending', 'approved', 'processing', 'paid', 'failed']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const query = QuerySchema.parse(searchParams);

    const { promoterId, status, from, to, limit, offset } = query;
    const deps = getServiceDeps();
    const result = await adminListPayouts(
      { promoterId, status, from, to },
      { limit, offset },
      deps
    );

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof PayoutError) {
      const { error, statusCode } = err.toHttpError();
      return NextResponse.json({ error }, { status: statusCode });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', details: err.errors } },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Interní chyba serveru.' } },
      { status: 500 }
    );
  }
}
