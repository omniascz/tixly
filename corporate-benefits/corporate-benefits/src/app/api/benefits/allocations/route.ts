import { NextRequest, NextResponse } from 'next/server';
import { allocateMonthly, type BenefitDB } from '../../../../services/program.service.js';
import { isBenefitError } from '../../../../lib/benefit-errors.js';
export interface BenefitDeps { db: BenefitDB }
function getDeps(ctx?: { deps?: BenefitDeps }): BenefitDeps { if (ctx?.deps) return ctx.deps; throw new Error('Not configured.'); }

export async function POST(req: NextRequest, ctx?: { deps?: BenefitDeps }) {
  try {
    const { programId, month } = await req.json();
    if (!programId || !month) return NextResponse.json({ error: 'programId and month required' }, { status: 400 });
    return NextResponse.json(await allocateMonthly(programId, month, getDeps(ctx).db), { status: 201 });
  } catch (err) { if (isBenefitError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode }); throw err; }
}
