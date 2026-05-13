import { NextRequest, NextResponse } from 'next/server';
import { CalculateFeeRequestSchema } from '../../../../../lib/zod-schemas';
import { calculateOrderFee } from '../../../../../services/fee.service';
import { FeeError } from '../../../../../lib/fee-errors';
import type { ServiceDeps } from '../../../../../lib/service-container';

// ---------------------------------------------------------------------------
// Deps factory — přepsatelná v testech
// ---------------------------------------------------------------------------
export let _getDeps: () => ServiceDeps = () => {
  throw new Error('DB adapter not configured — inject via _getDeps');
};

export function _setDeps(factory: () => ServiceDeps): void {
  _getDeps = factory;
}

function getServiceToken(): string {
  return process.env.INTERNAL_SERVICE_TOKEN ?? '';
}

// ---------------------------------------------------------------------------
// POST /api/platform/internal/calculate-fee
// Interní endpoint — volá se při vytváření objednávky
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest): Promise<NextResponse> {
  const serviceToken = request.headers.get('x-service-token');
  const expectedToken = getServiceToken();

  if (!serviceToken || !expectedToken || serviceToken !== expectedToken) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Neplatný nebo chybějící x-service-token.' } }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Tělo požadavku není platný JSON.' } }, { status: 400 });
  }

  const parseResult = CalculateFeeRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: parseResult.error.errors[0]?.message ?? 'Neplatná data.' } },
      { status: 400 },
    );
  }

  const { promoterId, lineItems } = parseResult.data;

  try {
    const result = await calculateOrderFee(promoterId, lineItems, _getDeps());
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof FeeError) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}
