import { NextRequest, NextResponse } from 'next/server';
import {
  getClientByClientId, validateRedirectUri, validateGrantType, validateScope,
  type OAuthDB,
} from '../../../../services/client.service.js';
import { issueAuthorizationCode } from '../../../../services/token.service.js';
import { isOAuthError, OAuthError } from '../../../../lib/oauth-errors.js';
import type { PkceMethod } from '../../../../lib/pkce.js';

export interface OAuthDeps { db: OAuthDB }
function getDeps(ctx?: { deps?: OAuthDeps }): OAuthDeps {
  if (ctx?.deps) return ctx.deps;
  throw new Error('Production dependencies not configured.');
}

/**
 * POST /oauth/authorize — authorization endpoint.
 *
 * Called after the user has approved the consent screen. The caller must
 * have already authenticated the user — we receive `user_id` from the
 * logged-in session.
 */
export async function POST(req: NextRequest, ctx?: { deps?: OAuthDeps }) {
  const deps = getDeps(ctx);

  try {
    const body = await req.json();
    const {
      client_id, redirect_uri, response_type, scope,
      code_challenge, code_challenge_method, user_id, state,
    } = body as Record<string, string>;

    if (response_type !== 'code') {
      throw new OAuthError('unsupported_response_type', 'Only response_type=code supported.');
    }
    if (!client_id || !redirect_uri || !code_challenge || !user_id) {
      throw new OAuthError('invalid_request', 'Missing required parameters.');
    }

    const client = await getClientByClientId(client_id, deps.db);
    validateGrantType(client, 'authorization_code');
    validateRedirectUri(client, redirect_uri);
    const scopes = validateScope(client, scope ?? '');

    const method = (code_challenge_method ?? 'plain') as PkceMethod;
    if (method !== 'plain' && method !== 'S256') {
      throw new OAuthError('invalid_request', 'Invalid code_challenge_method.');
    }

    const code = await issueAuthorizationCode(
      client_id, user_id, redirect_uri, scopes, code_challenge, method, deps.db,
    );

    // Redirect URL with code + state (caller handles the HTTP redirect)
    const url = new URL(redirect_uri);
    url.searchParams.set('code', code);
    if (state) url.searchParams.set('state', state);

    return NextResponse.json({ redirectTo: url.toString(), code });
  } catch (err) {
    if (isOAuthError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
