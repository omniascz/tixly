import { NextRequest, NextResponse } from 'next/server';
import { seedTenant, listScenarios, type SandboxDB } from '../../../../services/seed.service.js';
import { isSandboxError } from '../../../../lib/sandbox-errors.js';

export interface SandboxDeps { db: SandboxDB }
function getDeps(ctx?: { deps?: SandboxDeps }): SandboxDeps {
  if (ctx?.deps) return ctx.deps; throw new Error('Not configured.');
}

export async function GET() {
  return NextResponse.json({ scenarios: listScenarios() });
}

export async function POST(req: NextRequest, ctx?: { deps?: SandboxDeps }) {
  try {
    const { tenantId, scenario } = await req.json();
    if (!tenantId || !scenario) {
      return NextResponse.json({ error: 'tenantId and scenario required' }, { status: 400 });
    }
    return NextResponse.json(await seedTenant(tenantId, scenario, getDeps(ctx).db), { status: 201 });
  } catch (err) {
    if (isSandboxError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
