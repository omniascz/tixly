import { z } from 'zod';
import { BankReconciliationError } from '../../../../../lib/bank-errors.js';
import { getServiceDeps } from '../../../../../lib/service-container.js';
import { getMatchingStats } from '../../../../../services/payment-matching.js';

const QuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

function requireAdmin(req: Request): void {
  const role = req.headers.get('x-user-role');
  if (role !== 'admin' && role !== 'platform_admin') {
    throw new BankReconciliationError('MATCH_FAILED', { reason: 'admin required' });
  }
}

/** GET /api/bank/payments/stats — matching statistics */
export async function GET(req: Request): Promise<Response> {
  try {
    requireAdmin(req);
    const url = new URL(req.url);
    const query = QuerySchema.parse({
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
    });

    const deps = getServiceDeps();
    const period = query.from && query.to
      ? { from: new Date(query.from), to: new Date(query.to) }
      : undefined;

    const stats = await getMatchingStats(deps.db, period);
    return Response.json(stats);
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
    console.error('[bank/payments/stats] error', err);
    return Response.json({ error: 'INTERNAL', message: 'Vnitřní chyba.' }, { status: 500 });
  }
}
