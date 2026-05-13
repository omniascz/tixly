import { z } from 'zod';
import { BankReconciliationError } from '../../../../../../lib/bank-errors.js';
import { getServiceDeps } from '../../../../../../lib/service-container.js';
import { manualMatchPayment } from '../../../../../../services/reconciliation.service.js';

const BodySchema = z.object({
  orderId: z.string().min(1),
});

function requireAdmin(req: Request): { userId: string } {
  const role = req.headers.get('x-user-role');
  const userId = req.headers.get('x-user-id');
  if ((role !== 'admin' && role !== 'platform_admin') || !userId) {
    throw new BankReconciliationError('MATCH_FAILED', { reason: 'admin required' });
  }
  return { userId };
}

export async function POST(
  req: Request,
  context: { params: { paymentId: string } },
): Promise<Response> {
  try {
    const { userId } = requireAdmin(req);
    const { orderId } = BodySchema.parse(await req.json());
    const deps = getServiceDeps();
    const record = await manualMatchPayment(context.params.paymentId, orderId, userId, deps);
    return Response.json(record);
  } catch (err) {
    if (err instanceof BankReconciliationError) {
      return Response.json(
        { error: err.code, message: err.message },
        { status: err.statusCode },
      );
    }
    if (err instanceof z.ZodError) {
      return Response.json(
        { error: 'INVALID_INPUT', details: err.issues },
        { status: 400 },
      );
    }
    console.error('[bank/payments/match] error', err);
    return Response.json({ error: 'INTERNAL', message: 'Vnitřní chyba.' }, { status: 500 });
  }
}
