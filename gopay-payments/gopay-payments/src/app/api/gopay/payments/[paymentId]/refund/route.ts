// =============================================================================
// POST /api/gopay/payments/[paymentId]/refund — admin-only refund
// =============================================================================

import { NextResponse } from 'next/server';
import { refundGopayPayment } from '../../../../../../services/gopay-payment.service.js';
import { getServiceDeps } from '../../../../../../lib/service-container.js';
import { GopayError, isGopayError } from '../../../../../../lib/gopay-errors.js';

export async function POST(
  request: Request,
  context: { params: { paymentId: string } },
): Promise<Response> {
  try {
    if (request.headers.get('x-is-admin') !== 'true') {
      return NextResponse.json(
        { error: 'FORBIDDEN', message: 'Pouze administrátor může provádět refund.' },
        { status: 403 },
      );
    }

    const body = (await request.json()) as { amountHalire?: number };
    if (typeof body.amountHalire !== 'number') {
      throw new GopayError('GOPAY_INVALID_AMOUNT');
    }

    const deps = getServiceDeps();
    const result = await refundGopayPayment(context.params.paymentId, body.amountHalire, deps);
    return NextResponse.json(result);
  } catch (err) {
    if (isGopayError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    // eslint-disable-next-line no-console
    console.error('[gopay POST /payments/:id/refund] unexpected error:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Interní chyba serveru.' }, { status: 500 });
  }
}
