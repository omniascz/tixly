/**
 * POST /api/identity/onfido/webhook
 *
 * Onfido posts here when a workflow run completes. We verify the HMAC-SHA256
 * signature in `X-SHA2-Signature` and hand off to the service layer.
 *
 * IMPORTANT: we must pass the RAW request body (not re-serialized JSON) to
 * the service — otherwise HMAC validation will fail.
 */

import { NextRequest, NextResponse } from 'next/server';

import { handleOnfidoWebhook, type ServiceDeps } from '../../../../../services/onfido.service.js';
import { IdentityError, ONFIDO_ERROR_MESSAGES } from '../../../../../lib/identity-errors.js';

declare const platformDeps: ServiceDeps;
function getDeps(): ServiceDeps {
  if (typeof platformDeps !== 'undefined') return platformDeps;
  throw new Error('Platform deps not configured');
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const signature = request.headers.get('x-sha2-signature') ?? '';
  const rawBody   = await request.text();

  try {
    const deps = getDeps();
    const result = await handleOnfidoWebhook(rawBody, signature, deps);
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (err) {
    if (err instanceof IdentityError) {
      const meta = ONFIDO_ERROR_MESSAGES[err.code] ?? { message: err.message, status: 500 };
      return NextResponse.json({ error: meta.message, code: err.code }, { status: meta.status });
    }
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
