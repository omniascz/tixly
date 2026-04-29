import { NextRequest, NextResponse } from 'next/server';
import { listTransactions, type BenefitDB } from '../../../../../../services/wallet.service.js';
import { isBenefitError } from '../../../../../../lib/benefit-errors.js';
export interface BenefitDeps { db: BenefitDB }
function getDeps(ctx?: { deps?: BenefitDeps }): BenefitDeps { if (ctx?.deps) return ctx.deps; throw new Error('Not configured.'); }

export async function GET(req: NextRequest, ctx?: { params?: { employeeId: string }; deps?: BenefitDeps }) {
  const p = req.nextUrl.searchParams;
  try {
    return NextResponse.json({
      transactions: await listTransactions(
        ctx?.params?.employeeId ?? '',
        p.get('from') ?? undefined,
        p.get('to') ?? undefined,
        getDeps(ctx).db,
      ),
    });
  } catch (err) { if (isBenefitError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode }); throw err; }
}
