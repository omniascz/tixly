import { NextRequest, NextResponse } from 'next/server';
import { getEmployee, deactivateEmployee, type BenefitDB } from '../../../../../services/employer.service.js';
import { isBenefitError } from '../../../../../lib/benefit-errors.js';
export interface BenefitDeps { db: BenefitDB }
function getDeps(ctx?: { deps?: BenefitDeps }): BenefitDeps { if (ctx?.deps) return ctx.deps; throw new Error('Not configured.'); }

export async function GET(_req: NextRequest, ctx?: { params?: { employeeId: string }; deps?: BenefitDeps }) {
  try { return NextResponse.json(await getEmployee(ctx?.params?.employeeId ?? '', getDeps(ctx).db)); }
  catch (err) { if (isBenefitError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode }); throw err; }
}
export async function DELETE(_req: NextRequest, ctx?: { params?: { employeeId: string }; deps?: BenefitDeps }) {
  try { return NextResponse.json(await deactivateEmployee(ctx?.params?.employeeId ?? '', getDeps(ctx).db)); }
  catch (err) { if (isBenefitError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode }); throw err; }
}
