import { NextRequest, NextResponse } from 'next/server';
import { createTenant, listTenants, type SandboxDB } from '../../../../services/tenant.service.js';
import { isSandboxError } from '../../../../lib/sandbox-errors.js';

export interface SandboxDeps { db: SandboxDB }
function getDeps(ctx?: { deps?: SandboxDeps }): SandboxDeps {
  if (ctx?.deps) return ctx.deps; throw new Error('Not configured.');
}

export async function GET(req: NextRequest, ctx?: { deps?: SandboxDeps }) {
  const email = req.nextUrl.searchParams.get('ownerEmail');
  if (!email) return NextResponse.json({ error: 'ownerEmail required' }, { status: 400 });
  return NextResponse.json({ tenants: await listTenants(email, getDeps(ctx).db) });
}

export async function POST(req: NextRequest, ctx?: { deps?: SandboxDeps }) {
  try {
    return NextResponse.json(await createTenant(await req.json(), getDeps(ctx).db), { status: 201 });
  } catch (err) {
    if (isSandboxError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
