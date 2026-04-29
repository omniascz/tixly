import { z } from 'zod';
import { BankReconciliationError } from '../../../../lib/bank-errors.js';
import { getServiceDeps } from '../../../../lib/service-container.js';
import { generatePaymentQr } from '../../../../services/reconciliation.service.js';

const BodySchema = z.object({
  amountHalire: z.number().int().nonnegative(),
  variableSymbol: z.string().regex(/^\d{1,10}$/),
  message: z.string().max(200).optional(),
  dueDate: z.string().optional(),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const json = await req.json();
    const input = BodySchema.parse(json);
    const deps = getServiceDeps();
    const result = await generatePaymentQr(input, deps);
    return Response.json(result);
  } catch (err) {
    if (err instanceof BankReconciliationError) {
      return Response.json(
        { error: err.code, message: err.message },
        { status: err.statusCode },
      );
    }
    if (err instanceof z.ZodError) {
      return Response.json(
        { error: 'INVALID_VARIABLE_SYMBOL', message: 'Neplatný vstup.', details: err.issues },
        { status: 400 },
      );
    }
    console.error('[bank/qr] error', err);
    return Response.json({ error: 'INTERNAL', message: 'Vnitřní chyba.' }, { status: 500 });
  }
}
