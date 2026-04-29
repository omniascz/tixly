import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createPromoter } from '../../../../services/promoter.service.js';
import { isPlatformError } from '../../../../lib/platform-errors.js';
import { CreatePromoterSchema } from '../../../../lib/zod-schemas.js';
import type { ServiceDeps } from '../../../../lib/service-container.js';

// In production, inject real adapters via DI container
function getDeps(): ServiceDeps {
  throw new Error('ServiceDeps must be injected at runtime');
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const userId = req.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'Missing x-user-id header' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = CreatePromoterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 422 });
  }

  try {
    const deps = getDeps();
    const promoter = await createPromoter(parsed.data, userId, deps);
    return NextResponse.json(promoter, { status: 201 });
  } catch (err) {
    if (isPlatformError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}
