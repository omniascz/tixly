import { NextRequest, NextResponse } from 'next/server';
import { getWalletBalance, type BenefitDB } from '../../../../../../services/wallet.service.js';
import { listAllocations } from '../../../../../../services/program.service.js';
import { isBenefitError } from '../../../../../../lib/benefit-errors.js';
export interface BenefitDeps { db: BenefitDB }
function getDeps(ctx?: { deps?: BenefitDeps }): BenefitDeps { if (ctx?.deps) return ctx.deps; throw new Error('Not configured.'); }

export async function GET(_req: NextRequest, ctx?: { params?: { employeeId: string }; deps?: BenefitDeps }) {
  const deps = getDeps(ctx);
  const id = ctx?.params?.employeeId ?? '';
  try {
    const [balance, allocations] = await Promise.all([
      getWalletBalance(id, deps.db),
      listAllocations(id, deps.db),
    ]);
    return NextResponse.json({ balance, allocations });
  } catch (err) { if (isBenefitError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode }); throw err; }
}
