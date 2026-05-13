/**
 * GET /api/identity/bankid/callback
 *
 * BankID redirects here after user authentication.
 *
 * Query params (from BankID):
 *   code  — authorization code
 *   state — CSRF state token
 *
 * On success: 302 redirect to redirectAfter (stored in session)
 * On error:   302 redirect to /identity/error?reason=<code>
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleCallback } from '../../../../../services/bankid.service.js';
import { IdentityError } from '../../../../../lib/identity-errors.js';
import type { IdentityDeps } from '../../../../../services/bankid.service.js';

declare const platformDeps: IdentityDeps;

function getDeps(): IdentityDeps {
  if (typeof platformDeps !== 'undefined') return platformDeps;
  throw new Error('Platform deps not configured');
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const code  = searchParams.get('code');
  const state = searchParams.get('state');

  if (!code || !state) {
    return NextResponse.redirect(
      new URL('/identity/error?reason=missing_params', request.url),
    );
  }

  // Best-effort IP extraction (behind a proxy, X-Forwarded-For is set)
  const ipAddress =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';

  try {
    const deps = getDeps();
    const { redirectAfter } = await handleCallback(code, state, ipAddress, deps);

    // Redirect to the originally requested destination
    const destination = redirectAfter.startsWith('/')
      ? new URL(redirectAfter, request.url)
      : new URL('/dashboard', request.url);

    return NextResponse.redirect(destination);
  } catch (err) {
    const reason =
      err instanceof IdentityError ? err.code.toLowerCase() : 'internal_error';

    return NextResponse.redirect(
      new URL(`/identity/error?reason=${encodeURIComponent(reason)}`, request.url),
    );
  }
}
