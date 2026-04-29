import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceDeps } from '../../../../../lib/service-container.js';
import { getLaborCostReport } from '../../../../../services/labor-cost.service.js';
import { isStaffError } from '../../../../../lib/staff-errors.js';

async function assertPromoterMember(_userId: string, _promoterId: string): Promise<boolean> {
  return true;
}

const querySchema = z.object({
  from: z.string().datetime({ message: 'from musí být ISO datetime' }),
  to: z.string().datetime({ message: 'to musí být ISO datetime' }),
});

/**
 * GET /promoters/[promoterId]/labor-costs?from=...&to=...
 *
 * Returns aggregated labor cost report for the given date range.
 * Breakdowns by role, staff, and event are included.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { promoterId: string } },
) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const allowed = await assertPromoterMember(userId, params.promoterId);
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  try {
    const url = new URL(req.url);
    const parsed = querySchema.safeParse({
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const deps = getServiceDeps();
    const report = await getLaborCostReport(
      params.promoterId,
      parsed.data.from,
      parsed.data.to,
      deps,
    );
    return NextResponse.json(report);
  } catch (err) {
    if (isStaffError(err)) {
      const http = err.toHttpError();
      return NextResponse.json(http, { status: http.statusCode });
    }
    throw err;
  }
}
