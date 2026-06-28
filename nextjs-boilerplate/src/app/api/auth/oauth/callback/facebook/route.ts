/**
 * GET /api/auth/oauth/callback/facebook
 *
 * Facebook OAuth callback — Facebook uses plain OAuth 2.0 (no id_token JWT).
 * Flow:
 *  1. CSRF state check
 *  2. Exchange code for access_token via Facebook token endpoint
 *  3. Fetch /me?fields=id,name,email via Graph API (no JWKS needed)
 *  4. Resolve or create user in identity.oauth_accounts
 *  5. Issue Tixly JWT + redirect
 *
 * Note: Facebook may not return email if the user registered with a phone number.
 * In that case we reject with an explanatory error.
 *
 * Required env: FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, NEXT_PUBLIC_APP_URL
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveOAuthUser, oauthLoginResponse } from '@/lib/oauth/provider';

export const dynamic = 'force-dynamic';

interface FbTokenResponse {
  access_token?: string;
  error?: { message: string };
}

interface FbMeResponse {
  id:     string;
  name?:  string;
  email?: string;
  error?: { message: string };
}

export async function GET(req: NextRequest): Promise<Response> {
  const { searchParams } = req.nextUrl;
  const code  = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  const appUrl       = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const appId        = process.env.FACEBOOK_APP_ID ?? '';
  const appSecret    = process.env.FACEBOOK_APP_SECRET ?? '';
  const redirectUri  = `${appUrl}/api/auth/oauth/callback/facebook`;

  if (error || searchParams.get('error_reason')) {
    return NextResponse.redirect(`${appUrl}/login?error=oauth_denied`);
  }

  const cookieState = req.cookies.get('oauth_state')?.value;
  if (!state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(`${appUrl}/login?error=oauth_state_mismatch`);
  }

  if (!code) {
    return NextResponse.redirect(`${appUrl}/login?error=oauth_no_code`);
  }

  // Exchange code for access_token
  let accessToken: string;
  try {
    const tokenParams = new URLSearchParams({
      client_id:     appId,
      client_secret: appSecret,
      redirect_uri:  redirectUri,
      code,
    });
    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?${tokenParams.toString()}`,
    );
    const tokenData = (await tokenRes.json()) as FbTokenResponse;
    if (!tokenData.access_token) {
      return NextResponse.redirect(`${appUrl}/login?error=oauth_token_exchange`);
    }
    accessToken = tokenData.access_token;
  } catch {
    return NextResponse.redirect(`${appUrl}/login?error=oauth_token_exchange`);
  }

  // Fetch user info from Graph API
  let fbUser: FbMeResponse;
  try {
    const meRes = await fetch(
      `https://graph.facebook.com/v19.0/me?fields=id,name,email&access_token=${encodeURIComponent(accessToken)}`,
    );
    fbUser = (await meRes.json()) as FbMeResponse;
    if (fbUser.error || !fbUser.id) {
      return NextResponse.redirect(`${appUrl}/login?error=oauth_user_fetch`);
    }
  } catch {
    return NextResponse.redirect(`${appUrl}/login?error=oauth_user_fetch`);
  }

  if (!fbUser.email) {
    // Facebook registered with phone — we can't create an account without email
    return NextResponse.redirect(
      `${appUrl}/login?error=oauth_no_email&hint=facebook_phone`,
    );
  }

  const { userId } = await resolveOAuthUser({
    provider:       'facebook',
    providerUserId: fbUser.id,
    email:          fbUser.email,
    name:           fbUser.name,
  });

  const next = req.cookies.get('oauth_next')?.value ?? '/tickets';
  const redirectTo = `${appUrl}${next.startsWith('/') ? next : '/tickets'}`;

  const res = await oauthLoginResponse(userId, redirectTo);
  (res as NextResponse).cookies?.delete?.('oauth_state');
  (res as NextResponse).cookies?.delete?.('oauth_next');
  return res;
}
