// POST /api/promoters/[promoterId]/cashback/apply
// Interní endpoint — volá se z objednávkového flow po úspěšné platbě.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceDeps } from '../../../../../../lib/service-container.js';
import { applyCashback } from '../../../../../../services/cashback.service.js';
import { CashbackError } from '../../../../../../lib/cashback-errors.js';

const BodySchema = z.object({
  userId: z.string().uuid(),
  orderId: z.string().min(1),
  orderAmountHalire: z.number().int().positive(),
  eventId: z.string().uuid().optional(),
});

export async function POST(
  req: Request,
  ctx: { params: { promoterId: string } },
): Promise<Response> {
  try {
    const serviceToken = req.headers.get('x-service-token');
    if (serviceToken !== process.env.INTERNAL_SERVICE_TOKEN) {
      return NextResponse.json(
        { error: 'Nedostatečná oprávnění (service auth).' },
        { status: 403 },
      );
    }

    const json = (await req.json()) as unknown;
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Neplatný vstup.', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const deps = await getServiceDeps();
    const result = await applyCashback(
      { ...parsed.data, promoterId: ctx.params.promoterId },
      deps,
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CashbackError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode },
      );
    }
    return NextResponse.json(
      { error: 'Interní chyba serveru.' },
      { status: 500 },
    );
  }
}
