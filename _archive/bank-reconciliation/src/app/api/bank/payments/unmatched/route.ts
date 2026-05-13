import { BankReconciliationError } from '../../../../../lib/bank-errors.js';
import { getServiceDeps } from '../../../../../lib/service-container.js';
import { listUnmatchedPayments } from '../../../../../services/reconciliation.service.js';

function requireAdmin(req: Request): void {
  const role = req.headers.get('x-user-role');
  if (role !== 'admin' && role !== 'platform_admin') {
    throw new BankReconciliationError('MATCH_FAILED', { reason: 'admin required' });
  }
}

export async function GET(req: Request): Promise<Response> {
  try {
    requireAdmin(req);
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get('limit') ?? '50');
    const offset = Number(url.searchParams.get('offset') ?? '0');
    const deps = getServiceDeps();
    const result = await listUnmatchedPayments(deps, { limit, offset });
    return Response.json(result);
  } catch (err) {
    if (err instanceof BankReconciliationError) {
      return Response.json(
        { error: err.code, message: err.message },
        { status: err.statusCode === 500 && err.code === 'MATCH_FAILED' ? 403 : err.statusCode },
      );
    }
    console.error('[bank/payments/unmatched] error', err);
    return Response.json({ error: 'INTERNAL', message: 'Vnitřní chyba.' }, { status: 500 });
  }
}
