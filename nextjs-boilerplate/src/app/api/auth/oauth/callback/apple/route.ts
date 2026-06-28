/**
 * POST /api/auth/oauth/callback/apple
 *
 * Apple Sign In callback handler. Apple uses response_mode=form_post,
 * so this is a POST with application/x-www-form-urlencoded body.
 *
 * Body fields:
 *   code:     authorization code
 *   id_token: JWT signed by Apple (contains sub + email)
 *   state:    our state for CSRF
 *   user:     JSON string "{name:{firstName,lastName},email:...}" (FIRST LOGIN ONLY)
 *
 * Strategy: verify id_token directly from Apple's JWKS — no code exchange needed
 * since the id_token already contains the user's sub and email.
 *
 * Required env:
 *   APPLE_SERVICE_ID, NEXT_PUBLIC_APP_URL
 */

import { NextRequest, NextResponse } from 'next/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { resolveOAuthUser, oauthLoginResponse } from '@/lib/oauth/provider';

export const dynamic = 'force-dynamic';

const APPLE_JWKS = createRemoteJWKSet(
  new URL('https://appleid.apple.com/auth/keys'),
);

interface AppleIdTokenPayload {
  sub:   string;
  email?: string;
  email_verified?: boolean | string;
  nonce?: string;
}

interface AppleUserField {
  name?: { firstName?: string; lastName?: string };
  email?: string;
}

export async function POST(req: NextRequest): Promise<Response> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  let formData: URLSearchParams;
  try {
    const text = await req.text();
    formData   = new URLSearchParams(text);
  } catch {
    return NextResponse.redirect(`${appUrl}/login?error=oauth_bad_body`);
  }

  const idToken  = formData.get('id_token');
  const state    = formData.get('state');
  const userJson = formData.get('user'); // only on first auth

  // CSRF verification
  const cookieState = req.cookies.get('oauth_state')?.value;
  if (!state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(`${appUrl}/login?error=oauth_state_mismatch`);
  }

  if (!idToken) {
    return NextResponse.redirect(`${appUrl}/login?error=oauth_no_id_token`);
  }

  const serviceId = process.env.APPLE_SERVICE_ID ?? '';

  // Verify Apple id_token
  let claims: AppleIdTokenPayload;
  try {
    const { payload } = await jwtVerify(idToken, APPLE_JWKS, {
      issuer:     'https://appleid.apple.com',
      audience:   serviceId,
      algorithms: ['RS256'],
    });
    claims = payload as unknown as AppleIdTokenPayload;
  } catch {
    return NextResponse.redirect(`${appUrl}/login?error=oauth_invalid_token`);
  }

  if (!claims.sub) {
    return NextResponse.redirect(`${appUrl}/login?error=oauth_no_sub`);
  }

  // Apple may hide the real email after first sign-in (relay address)
  const email = claims.email;
  if (!email) {
    return NextResponse.redirect(`${appUrl}/login?error=oauth_no_email`);
  }

  // Apple provides name only on first login — parse it if present
  let name: string | undefined;
  if (userJson) {
    try {
      const parsed = JSON.parse(userJson) as AppleUserField;
      const parts  = [parsed.name?.firstName, parsed.name?.lastName].filter(Boolean);
      if (parts.length > 0) name = parts.join(' ');
    } catch {
      // Name is optional — proceed without it
    }
  }

  const { userId } = await resolveOAuthUser({
    provider:       'apple',
    providerUserId: claims.sub,
    email,
    name,
  });

  const next = req.cookies.get('oauth_next')?.value ?? '/tickets';
  const redirectTo = `${appUrl}${next.startsWith('/') ? next : '/tickets'}`;

  const res = await oauthLoginResponse(userId, redirectTo);

  (res as NextResponse).cookies?.delete?.('oauth_state');
  (res as NextResponse).cookies?.delete?.('oauth_nonce');
  (res as NextResponse).cookies?.delete?.('oauth_next');

  return res;
}
