import { z } from 'zod';
import { BankReconciliationError } from '../../../../../lib/bank-errors.js';
import { getServiceDeps } from '../../../../../lib/service-container.js';
import { matchAllUnmatched, type MatchingConfig } from '../../../../../services/payment-matching.js';

const BodySchema = z.object({
  autoMatchThreshold: z.number().min(0).max(1).optional(),
  fuzzyAmountToleranceHalire: z.number().int().min(0).optional(),
  enableLevel4Ai: z.boolean().optional(),
  maxCandidates: z.number().int().min(1).max(50).optional(),
}).optional();

function requireAdmin(req: Request): void {
  const role = req.headers.get('x-user-role');
  if (role !== 'admin' && role !== 'platform_admin') {
    throw new BankReconciliationError('MATCH_FAILED', { reason: 'admin required' });
  }
}

/** POST /api/bank/payments/batch-match — run 4-level matching on all unmatched payments */
export async function POST(req: Request): Promise<Response> {
  try {
    requireAdmin(req);
    const body = BodySchema.parse(await req.json().catch(() => undefined));
    const deps = getServiceDeps();

    const config: Partial<MatchingConfig> = {};
    if (body?.autoMatchThreshold != null) config.autoMatchThreshold = body.autoMatchThreshold;
    if (body?.fuzzyAmountToleranceHalire != null) config.fuzzyAmountToleranceHalire = body.fuzzyAmountToleranceHalire;
    if (body?.enableLevel4Ai != null) config.enableLevel4Ai = body.enableLevel4Ai;
    if (body?.maxCandidates != null) config.maxCandidates = body.maxCandidates;

    const result = await matchAllUnmatched(deps.db, config);
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
        { error: 'INVALID_INPUT', details: err.issues },
        { status: 400 },
      );
    }
    console.error('[bank/payments/batch-match] error', err);
    return Response.json({ error: 'INTERNAL', message: 'Vnitřní chyba.' }, { status: 500 });
  }
}
