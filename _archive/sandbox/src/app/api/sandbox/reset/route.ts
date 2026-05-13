import { NextRequest, NextResponse } from 'next/server';
import { resetTenant, type SandboxDB } from '../../../../services/seed.service.js';
import { isSandboxError } from '../../../../lib/sandbox-errors.js';

export interface SandboxDeps { db: SandboxDB }
function getDeps(ctx?: { deps?: SandboxDeps }): SandboxDeps {
  if (ctx?.deps) return ctx.deps; throw new Error('Not configured.');
}

export async function POST(req: NextRequest, ctx?: { deps?: SandboxDeps }) {
  try {
    const { tenantId } = await req.json();
    if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 });
    await resetTenant(tenantId, getDeps(ctx).db);
    return NextResponse.json({ reset: true });
  } catch (err) {
    if (isSandboxError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
