import { NextRequest, NextResponse } from 'next/server';
import { addEmployee, listEmployees, type BenefitDB } from '../../../../../../services/employer.service.js';
import { isBenefitError } from '../../../../../../lib/benefit-errors.js';
export interface BenefitDeps { db: BenefitDB }
function getDeps(ctx?: { deps?: BenefitDeps }): BenefitDeps { if (ctx?.deps) return ctx.deps; throw new Error('Not configured.'); }

export async function GET(req: NextRequest, ctx?: { params?: { employerId: string }; deps?: BenefitDeps }) {
  const activeOnly = req.nextUrl.searchParams.get('activeOnly') === 'true';
  return NextResponse.json({ employees: await listEmployees(ctx?.params?.employerId ?? '', activeOnly, getDeps(ctx).db) });
}
export async function POST(req: NextRequest, ctx?: { params?: { employerId: string }; deps?: BenefitDeps }) {
  try {
    return NextResponse.json(await addEmployee({ ...await req.json(), employerId: ctx?.params?.employerId }, getDeps(ctx).db), { status: 201 });
  } catch (err) { if (isBenefitError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode }); throw err; }
}
