/**
 * POST /api/oauth/token
 *
 * OAuth 2.0 token endpoint (RFC 6749 §4.1.3 + §6).
 *
 * Body: application/x-www-form-urlencoded NEBO JSON
 *   - grant_type=authorization_code | refresh_token
 *   - client_id + client_secret (basic auth nebo body)
 *   - code + redirect_uri (pokud auth code)
 *   - refresh_token (pokud refresh)
 *   - code_verifier (PKCE)
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyClientSecret, exchangeCodeForTokens, refreshAccessToken } from '@/lib/oauth/flow';

export async function POST(req: NextRequest): Promise<Response> {
  let params: Record<string, string> = {};

  const contentType = req.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    params = await req.json().catch(() => ({}));
  } else {
    const text = await req.text();
    params = Object.fromEntries(new URLSearchParams(text).entries());
  }

  // Basic auth z header (alternative k body)
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
      const [id, secret] = decoded.split(':');
      if (!params.client_id) params.client_id = id;
      if (!params.client_secret) params.client_secret = secret;
    } catch {
      // ignore
    }
  }

  if (!params.client_id || !params.client_secret) {
    return NextResponse.json({ error: 'invalid_client' }, { status: 401 });
  }

  const client = await verifyClientSecret(params.client_id, params.client_secret);
  if (!client) {
    return NextResponse.json({ error: 'invalid_client' }, { status: 401 });
  }

  if (params.grant_type === 'authorization_code') {
    if (!params.code || !params.redirect_uri) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }
    const result = await exchangeCodeForTokens({
      code: params.code,
      clientPkId: client.id,
      redirectUri: params.redirect_uri,
      codeVerifier: params.code_verifier,
    });
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({
      access_token: result.accessToken,
      token_type: 'Bearer',
      expires_in: result.expiresIn,
      refresh_token: result.refreshToken,
      scope: result.scopes.join(' '),
    });
  }

  if (params.grant_type === 'refresh_token') {
    if (!params.refresh_token) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }
    const result = await refreshAccessToken(params.refresh_token, client.id);
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({
      access_token: result.accessToken,
      token_type: 'Bearer',
      expires_in: result.expiresIn,
      refresh_token: result.refreshToken,
      scope: result.scopes.join(' '),
    });
  }

  return NextResponse.json({ error: 'unsupported_grant_type' }, { status: 400 });
}
