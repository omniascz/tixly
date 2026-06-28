/**
 * GET /api/auth/oauth/callback/google
 *
 * Google OAuth 2.0 callback handler.
 *  1. Verify CSRF state cookie
 *  2. Exchange code for id_token via Google token endpoint
 *  3. Verify id_token using Google's JWKS (via jose createRemoteJWKSet)
 *  4. Resolve or create user
 *  5. Issue Tixly JWT + redirect
 *
 * Required env:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, NEXT_PUBLIC_APP_URL
 */

import { NextRequest, NextResponse } from 'next/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { resolveOAuthUser, oauthLoginResponse } from '@/lib/oauth/provider';

export const dynamic = 'force-dynamic';

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs'),
);

interface GoogleTokenResponse {
  id_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleIdTokenPayload {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  const { searchParams } = req.nextUrl;
  const code  = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  if (error) {
    return NextResponse.redirect(`${appUrl}/login?error=oauth_denied`);
  }

  // CSRF verification
  const cookieState = req.cookies.get('oauth_state')?.value;
  if (!state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(`${appUrl}/login?error=oauth_state_mismatch`);
  }

  if (!code) {
    return NextResponse.redirect(`${appUrl}/login?error=oauth_no_code`);
  }

  const clientId     = process.env.GOOGLE_CLIENT_ID ?? '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
  const redirectUri  = `${appUrl}/api/auth/oauth/callback/google`;

  // Exchange code for tokens
  let tokenData: GoogleTokenResponse;
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  redirectUri,
        grant_type:    'authorization_code',
      }),
    });
    tokenData = (await tokenRes.json()) as GoogleTokenResponse;
  } catch {
    return NextResponse.redirect(`${appUrl}/login?error=oauth_token_exchange`);
  }

  if (!tokenData.id_token) {
    return NextResponse.redirect(`${appUrl}/login?error=oauth_no_id_token`);
  }

  // Verify id_token signature + claims
  let claims: GoogleIdTokenPayload;
  try {
    const { payload } = await jwtVerify(tokenData.id_token, GOOGLE_JWKS, {
      issuer:     ['https://accounts.google.com', 'accounts.google.com'],
      audience:   clientId,
      algorithms: ['RS256'],
    });
    claims = payload as unknown as GoogleIdTokenPayload;
  } catch {
    return NextResponse.redirect(`${appUrl}/login?error=oauth_invalid_token`);
  }

  if (!claims.email || !claims.email_verified) {
    return NextResponse.redirect(`${appUrl}/login?error=oauth_unverified_email`);
  }

  const name = [claims.given_name, claims.family_name].filter(Boolean).join(' ')
    || claims.name
    || undefined;

  const { userId } = await resolveOAuthUser({
    provider:        'google',
    providerUserId:  claims.sub,
    email:           claims.email,
    name,
  });

  const next = req.cookies.get('oauth_next')?.value ?? '/tickets';
  const redirectTo = `${appUrl}${next.startsWith('/') ? next : '/tickets'}`;

  const res = await oauthLoginResponse(userId, redirectTo);

  // Clear state cookies
  (res as NextResponse).cookies?.delete?.('oauth_state');
  (res as NextResponse).cookies?.delete?.('oauth_next');

  return res;
}
