import { NextRequest, NextResponse } from 'next/server';
import { registerClient, type OAuthDB } from '../../../../services/client.service.js';
import { isOAuthError } from '../../../../lib/oauth-errors.js';

export interface OAuthDeps { db: OAuthDB }
function getDeps(ctx?: { deps?: OAuthDeps }): OAuthDeps {
  if (ctx?.deps) return ctx.deps;
  throw new Error('Production dependencies not configured.');
}

export async function POST(req: NextRequest, ctx?: { deps?: OAuthDeps }) {
  try {
    const input = await req.json();
    const result = await registerClient(input, getDeps(ctx).db);
    return NextResponse.json({
      clientId: result.client.clientId,
      clientSecret: result.clientSecret,    // shown ONCE on registration
      name: result.client.name,
      clientType: result.client.clientType,
      redirectUris: result.client.redirectUris,
      allowedGrantTypes: result.client.allowedGrantTypes,
      allowedScopes: result.client.allowedScopes,
    }, { status: 201 });
  } catch (err) {
    if (isOAuthError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
