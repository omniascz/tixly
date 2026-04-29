import { BankReconciliationError } from '../../../../../../lib/bank-errors.js';
import { getServiceDeps } from '../../../../../../lib/service-container.js';
import { pollAndReconcile } from '../../../../../../services/reconciliation.service.js';

function requireCronAuth(req: Request): void {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization') || '';
  const role = req.headers.get('x-user-role');

  const cronOk = cronSecret && auth === `Bearer ${cronSecret}`;
  const adminOk = role === 'admin' || role === 'platform_admin';

  if (!cronOk && !adminOk) {
    throw new BankReconciliationError('MATCH_FAILED', { reason: 'unauthorized' });
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    requireCronAuth(req);
    const deps = getServiceDeps();
    const result = await pollAndReconcile(deps);
    return Response.json(result);
  } catch (err) {
    if (err instanceof BankReconciliationError) {
      return Response.json(
        { error: err.code, message: err.message },
        { status: err.code === 'MATCH_FAILED' ? 401 : err.statusCode },
      );
    }
    console.error('[cron/poll-bank] error', err);
    return Response.json({ error: 'INTERNAL', message: 'Vnitřní chyba.' }, { status: 500 });
  }
}
