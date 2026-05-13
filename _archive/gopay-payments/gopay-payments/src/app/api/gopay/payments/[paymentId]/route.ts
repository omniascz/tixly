// =============================================================================
// GET /api/gopay/payments/[paymentId] — vrací refreshnutý stav platby
// =============================================================================

import { NextResponse } from 'next/server';
import { getGopayPayment } from '../../../../../services/gopay-payment.service.js';
import { getServiceDeps } from '../../../../../lib/service-container.js';
import { isGopayError } from '../../../../../lib/gopay-errors.js';

export async function GET(
  _request: Request,
  context: { params: { paymentId: string } },
): Promise<Response> {
  try {
    const deps = getServiceDeps();
    const payment = await getGopayPayment(context.params.paymentId, deps);
    return NextResponse.json(payment);
  } catch (err) {
    if (isGopayError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    // eslint-disable-next-line no-console
    console.error('[gopay GET /payments/:id] unexpected error:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Interní chyba serveru.' }, { status: 500 });
  }
}
