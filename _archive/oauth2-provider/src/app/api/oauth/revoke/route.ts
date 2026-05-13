import { NextRequest, NextResponse } from 'next/server';
import { authenticateClient, type OAuthDB } from '../../../../services/client.service.js';
import { revokeToken } from '../../../../services/token.service.js';
import { isOAuthError, OAuthError } from '../../../../lib/oauth-errors.js';

export interface OAuthDeps { db: OAuthDB }
function getDeps(ctx?: { deps?: OAuthDeps }): OAuthDeps {
  if (ctx?.deps) return ctx.deps;
  throw new Error('Production dependencies not configured.');
}

/** POST /oauth/revoke — RFC 7009 token revocation. */
export async function POST(req: NextRequest, ctx?: { deps?: OAuthDeps }) {
  const deps = getDeps(ctx);
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Basic ')) {
      throw new OAuthError('invalid_client', 'Basic auth required.');
    }
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const [clientId, clientSecret] = decoded.split(':');
    await authenticateClient(clientId, clientSecret, deps.db);

    const body = await req.json();
    const token = body.token as string | undefined;
    if (!token) throw new OAuthError('invalid_request', 'token required.');

    await revokeToken(token, deps.db);
    // Per spec, always return 200 regardless of whether token was found
    return NextResponse.json({}, { status: 200 });
  } catch (err) {
    if (isOAuthError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
