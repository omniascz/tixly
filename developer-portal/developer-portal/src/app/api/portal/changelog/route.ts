import { NextRequest, NextResponse } from 'next/server';
import { getSpec } from '../../../../services/spec-registry.service.js';
import { diffSpecs } from '../../../../services/changelog.service.js';
import { isPortalError } from '../../../../lib/portal-errors.js';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const from = p.get('from');
  const to = p.get('to');
  if (!from || !to) return NextResponse.json({ error: 'from and to versions required' }, { status: 400 });
  try {
    const fromSpec = getSpec(from);
    const toSpec = getSpec(to);
    return NextResponse.json(diffSpecs(from, to, fromSpec, toSpec));
  } catch (err) {
    if (isPortalError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
