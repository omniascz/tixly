import { NextRequest, NextResponse } from 'next/server';
import { listSpecs, getSpec, registerSpec } from '../../../../services/spec-registry.service.js';
import { isPortalError } from '../../../../lib/portal-errors.js';

export async function GET(req: NextRequest) {
  const version = req.nextUrl.searchParams.get('version');
  if (version) {
    try { return NextResponse.json(getSpec(version)); }
    catch (err) { if (isPortalError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode }); throw err; }
  }
  return NextResponse.json({ specs: listSpecs() });
}

export async function POST(req: NextRequest) {
  try {
    const { version, spec } = await req.json();
    if (!version || !spec) return NextResponse.json({ error: 'version and spec required' }, { status: 400 });
    return NextResponse.json(registerSpec(version, spec), { status: 201 });
  } catch (err) {
    if (isPortalError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
