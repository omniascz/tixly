/**
 * GET /api/auth/oauth/apple
 *
 * Redirect to Apple Sign In authorization endpoint.
 * Apple uses response_mode=form_post, so the callback is a POST.
 *
 * Required env:
 *   APPLE_SERVICE_ID  (com.example.tixly)
 *   NEXT_PUBLIC_APP_URL
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const serviceId = process.env.APPLE_SERVICE_ID;
  const appUrl    = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  if (!serviceId) {
    return NextResponse.json({ error: 'APPLE_SERVICE_ID not configured' }, { status: 503 });
  }

  const state       = randomBytes(16).toString('hex');
  const redirectUri = `${appUrl}/api/auth/oauth/callback/apple`;
  const nonce       = randomBytes(16).toString('hex');

  const params = new URLSearchParams({
    client_id:     serviceId,
    redirect_uri:  redirectUri,
    response_type: 'code id_token',
    response_mode: 'form_post',
    scope:         'name email',
    state,
    nonce,
  });

  const res = NextResponse.redirect(
    `https://appleid.apple.com/auth/authorize?${params.toString()}`,
    302,
  );

  res.cookies.set('oauth_state', state, {
    httpOnly: true,
    sameSite: 'none', // Apple form_post requires cross-site
    secure: true,
    maxAge: 600,
    path: '/',
  });

  res.cookies.set('oauth_nonce', nonce, {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    maxAge: 600,
    path: '/',
  });

  const next = req.nextUrl.searchParams.get('next') ?? '/tickets';
  res.cookies.set('oauth_next', next, {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    maxAge: 600,
    path: '/',
  });

  return res;
}
