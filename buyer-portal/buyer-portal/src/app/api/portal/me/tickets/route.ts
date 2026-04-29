import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceDeps } from '../../../../../lib/service-container.js';
import { BuyerPortalError, isBuyerPortalError } from '../../../../../lib/buyer-portal-errors.js';
import { listBuyerTickets } from '../../../../../services/buyer-portal.service.js';

const querySchema = z.object({
  status: z
    .enum(['valid', 'used', 'cancelled', 'refunded', 'upcoming', 'past'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const userId = req.headers.get('x-user-id');
    if (!userId) {
      throw new BuyerPortalError('UNAUTHORIZED');
    }

    const url = new URL(req.url);
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'INVALID_QUERY', message: parsed.error.message },
        { status: 400 },
      );
    }

    const deps = getServiceDeps();
    const result = await listBuyerTickets(
      userId,
      { status: parsed.data.status },
      { limit: parsed.data.limit, offset: parsed.data.offset },
      deps,
    );

    return NextResponse.json(result);
  } catch (err) {
    if (isBuyerPortalError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 },
    );
  }
}
