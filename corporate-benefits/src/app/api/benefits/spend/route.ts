import { NextRequest, NextResponse } from 'next/server';
import { spend, refund, type BenefitDB } from '../../../../services/wallet.service.js';
import { isBenefitError } from '../../../../lib/benefit-errors.js';
export interface BenefitDeps { db: BenefitDB }
function getDeps(ctx?: { deps?: BenefitDeps }): BenefitDeps { if (ctx?.deps) return ctx.deps; throw new Error('Not configured.'); }

export async function POST(req: NextRequest, ctx?: { deps?: BenefitDeps }) {
  try {
    const body = await req.json();
    if (body.action === 'refund') {
      return NextResponse.json(await refund(body.transactionId, body.reason, getDeps(ctx).db));
    }
    return NextResponse.json({ transactions: await spend(body, getDeps(ctx).db) }, { status: 201 });
  } catch (err) { if (isBenefitError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode }); throw err; }
}
