/**
 * POST /api/identity/onfido/start
 *
 * Body: { firstName: string; lastName: string; email?: string }
 * Header: x-user-id — UUID of the platform user
 *
 * Returns: { applicantId, sdkToken, workflowRunId }
 */

import { NextRequest, NextResponse } from 'next/server';

import { startOnfidoVerification, type ServiceDeps } from '../../../../../services/onfido.service.js';
import { IdentityError, ONFIDO_ERROR_MESSAGES } from '../../../../../lib/identity-errors.js';

declare const platformDeps: ServiceDeps;
function getDeps(): ServiceDeps {
  if (typeof platformDeps !== 'undefined') return platformDeps;
  throw new Error('Platform deps not configured');
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'x-user-id header is required' }, { status: 400 });
  }

  let body: { firstName?: string; lastName?: string; email?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.firstName || !body.lastName) {
    return NextResponse.json(
      { error: 'firstName and lastName are required' },
      { status: 400 },
    );
  }

  try {
    const deps = getDeps();
    const referrer = request.headers.get('referer') ?? request.headers.get('origin') ?? '*://*/*';
    const result = await startOnfidoVerification(
      userId,
      { firstName: body.firstName, lastName: body.lastName, email: body.email },
      referrer,
      deps,
    );
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof IdentityError) {
      const meta = ONFIDO_ERROR_MESSAGES[err.code] ?? { message: err.message, status: 500 };
      return NextResponse.json({ error: meta.message, code: err.code }, { status: meta.status });
    }
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
