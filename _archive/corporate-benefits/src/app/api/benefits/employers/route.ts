import { NextRequest, NextResponse } from 'next/server';
import { createEmployer, listEmployers, type BenefitDB } from '../../../../services/employer.service.js';
import { isBenefitError } from '../../../../lib/benefit-errors.js';
export interface BenefitDeps { db: BenefitDB }
function getDeps(ctx?: { deps?: BenefitDeps }): BenefitDeps { if (ctx?.deps) return ctx.deps; throw new Error('Not configured.'); }

export async function GET(_req: NextRequest, ctx?: { deps?: BenefitDeps }) {
  return NextResponse.json({ employers: await listEmployers(getDeps(ctx).db) });
}
export async function POST(req: NextRequest, ctx?: { deps?: BenefitDeps }) {
  try { return NextResponse.json(await createEmployer(await req.json(), getDeps(ctx).db), { status: 201 }); }
  catch (err) { if (isBenefitError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode }); throw err; }
}
