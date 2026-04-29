import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateClient, validateGrantType, validateScope, validateRedirectUri,
  type OAuthDB,
} from '../../../../services/client.service.js';
import {
  exchangeAuthorizationCode, clientCredentialsGrant, refreshTokenGrant,
} from '../../../../services/token.service.js';
import { isOAuthError, OAuthError } from '../../../../lib/oauth-errors.js';

export interface OAuthDeps { db: OAuthDB }
function getDeps(ctx?: { deps?: OAuthDeps }): OAuthDeps {
  if (ctx?.deps) return ctx.deps;
  throw new Error('Production dependencies not configured.');
}

/**
 * POST /oauth/token — token endpoint (RFC 6749 §3.2)
 *
 * Accepts application/x-www-form-urlencoded per spec, but also JSON for ease.
 * Client authentication via Authorization: Basic <b64(client_id:client_secret)>
 * or via client_id + client_secret in body.
 */
export async function POST(req: NextRequest, ctx?: { deps?: OAuthDeps }) {
  const deps = getDeps(ctx);

  try {
    const contentType = req.headers.get('content-type') ?? '';
    let params: Record<string, string>;
    if (contentType.includes('application/json')) {
      params = await req.json();
    } else {
      const text = await req.text();
      params = Object.fromEntries(new URLSearchParams(text));
    }

    // Client authentication
    let clientId = params.client_id;
    let clientSecret: string | null = params.client_secret ?? null;
    const authHeader = req.headers.get('authorization');
    if (authHeader?.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
      const [hId, hSecret] = decoded.split(':');
      clientId = hId;
      clientSecret = hSecret;
    }
    if (!clientId) throw new OAuthError('invalid_client', 'client_id missing.');

    const client = await authenticateClient(clientId, clientSecret, deps.db);
    const grantType = params.grant_type;

    if (!grantType) throw new OAuthError('invalid_request', 'grant_type required.');

    if (grantType === 'authorization_code') {
      validateGrantType(client, 'authorization_code');
      if (!params.code || !params.redirect_uri || !params.code_verifier) {
        throw new OAuthError('invalid_request', 'code, redirect_uri, code_verifier required.');
      }
      validateRedirectUri(client, params.redirect_uri);
      const tokens = await exchangeAuthorizationCode(
        client, params.code, params.redirect_uri, params.code_verifier, deps.db,
      );
      return NextResponse.json(tokens);
    }

    if (grantType === 'client_credentials') {
      validateGrantType(client, 'client_credentials');
      const scopes = validateScope(client, params.scope ?? '');
      const tokens = await clientCredentialsGrant(client, scopes, deps.db);
      return NextResponse.json(tokens);
    }

    if (grantType === 'refresh_token') {
      validateGrantType(client, 'refresh_token');
      if (!params.refresh_token) throw new OAuthError('invalid_request', 'refresh_token required.');
      const tokens = await refreshTokenGrant(client, params.refresh_token, deps.db);
      return NextResponse.json(tokens);
    }

    throw new OAuthError('unsupported_grant_type', `Unsupported grant_type: ${grantType}`);
  } catch (err) {
    if (isOAuthError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
