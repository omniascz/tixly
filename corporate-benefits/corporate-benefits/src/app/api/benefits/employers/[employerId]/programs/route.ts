import { NextRequest, NextResponse } from 'next/server';
import { createProgram, listPrograms, type BenefitDB } from '../../../../../../services/program.service.js';
import { isBenefitError } from '../../../../../../lib/benefit-errors.js';
export interface BenefitDeps { db: BenefitDB }
function getDeps(ctx?: { deps?: BenefitDeps }): BenefitDeps { if (ctx?.deps) return ctx.deps; throw new Error('Not configured.'); }

export async function GET(_req: NextRequest, ctx?: { params?: { employerId: string }; deps?: BenefitDeps }) {
  return NextResponse.json({ programs: await listPrograms(ctx?.params?.employerId ?? '', getDeps(ctx).db) });
}
export async function POST(req: NextRequest, ctx?: { params?: { employerId: string }; deps?: BenefitDeps }) {
  try {
    return NextResponse.json(await createProgram({ ...await req.json(), employerId: ctx?.params?.employerId }, getDeps(ctx).db), { status: 201 });
  } catch (err) { if (isBenefitError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode }); throw err; }
}
