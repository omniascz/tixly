/**
 * GET /api/auth/oauth/facebook
 *
 * Redirect to Facebook OAuth dialog.
 * Required env: FACEBOOK_APP_ID, NEXT_PUBLIC_APP_URL
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const appId  = process.env.FACEBOOK_APP_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  if (!appId) {
    return NextResponse.json({ error: 'FACEBOOK_APP_ID not configured' }, { status: 503 });
  }

  const state       = randomBytes(16).toString('hex');
  const redirectUri = `${appUrl}/api/auth/oauth/callback/facebook`;

  const params = new URLSearchParams({
    client_id:     appId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'email,public_profile',
    state,
  });

  const res = NextResponse.redirect(
    `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`,
    302,
  );

  res.cookies.set('oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
    path: '/',
  });

  const next = req.nextUrl.searchParams.get('next') ?? '/tickets';
  res.cookies.set('oauth_next', next, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
    path: '/',
  });

  return res;
}
