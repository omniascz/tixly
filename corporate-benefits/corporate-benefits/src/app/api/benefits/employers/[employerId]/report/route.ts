import { NextRequest, NextResponse } from 'next/server';
import { getEmployerReport, type BenefitDB } from '../../../../../../services/report.service.js';
import { isBenefitError } from '../../../../../../lib/benefit-errors.js';
export interface BenefitDeps { db: BenefitDB }
function getDeps(ctx?: { deps?: BenefitDeps }): BenefitDeps { if (ctx?.deps) return ctx.deps; throw new Error('Not configured.'); }

export async function GET(req: NextRequest, ctx?: { params?: { employerId: string }; deps?: BenefitDeps }) {
  const month = req.nextUrl.searchParams.get('month');
  if (!month) return NextResponse.json({ error: 'month (YYYY-MM) required' }, { status: 400 });
  try {
    return NextResponse.json(await getEmployerReport(ctx?.params?.employerId ?? '', month, getDeps(ctx).db));
  } catch (err) { if (isBenefitError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode }); throw err; }
}
