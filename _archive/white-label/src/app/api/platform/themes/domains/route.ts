import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { createCustomDomain, listDomains } from '../../../../../services/domain.service';
import { isWhiteLabelError } from '../../../../../lib/plan-enforcement';
import type { DomainDeps } from '../../../../../services/domain.service';

const CreateDomainSchema = z.object({
  domain: z.string().min(4).max(253),
});

export async function GET(
  request: NextRequest,
  { deps }: { deps?: DomainDeps } = {},
): Promise<NextResponse> {
  const resolvedDeps = deps ?? getProductionDeps();
  const promoterId = request.headers.get('x-promoter-id');
  if (!promoterId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  try {
    const domains = await listDomains(promoterId, resolvedDeps);
    return NextResponse.json(domains);
  } catch (err) {
    if (isWhiteLabelError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

export async function POST(
  request: NextRequest,
  { deps }: { deps?: DomainDeps } = {},
): Promise<NextResponse> {
  const resolvedDeps = deps ?? getProductionDeps();
  const promoterId = request.headers.get('x-promoter-id');
  if (!promoterId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  let input: z.infer<typeof CreateDomainSchema>;
  try {
    input = CreateDomainSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: 'VALIDATION_ERROR', details: err.errors }, { status: 400 });
    }
    throw err;
  }

  try {
    const domain = await createCustomDomain(promoterId, input.domain, resolvedDeps);
    return NextResponse.json(domain, { status: 201 });
  } catch (err) {
    if (isWhiteLabelError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

function getProductionDeps(): DomainDeps {
  throw new Error('Production deps not configured');
}
