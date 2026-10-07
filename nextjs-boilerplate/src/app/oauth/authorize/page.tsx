/**
 * /oauth/authorize — User consent UI pro 3rd party app autorizace.
 *
 * Query params (per OAuth 2.0 spec):
 *   - response_type=code (required)
 *   - client_id (required)
 *   - redirect_uri (required)
 *   - scope (space-separated)
 *   - state (CSRF token, předáván zpět)
 *   - code_challenge + code_challenge_method (PKCE)
 *
 * Flow:
 *   1. User logged in? If not → redirect /login?next=/oauth/authorize?...
 *   2. Render consent screen (app info + requested scopes)
 *   3. Po approve → POST internal endpoint → issue code → redirect na redirect_uri
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Pool } from 'pg';
import { verifyToken } from '@/lib/auth';
import { pgPoolOptions } from '@/lib/db/pg-options';
import { lookupClient } from '@/lib/oauth/flow';
import { ConsentForm } from './ConsentForm';

import type { JSX } from 'react';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool(pgPoolOptions(process.env.DATABASE_URL));
  return pool;
}

interface PageProps {
  searchParams: Promise<{
    response_type?: string;
    client_id?: string;
    redirect_uri?: string;
    scope?: string;
    state?: string;
    code_challenge?: string;
    code_challenge_method?: string;
  }>;
}

export default async function AuthorizePage({ searchParams }: PageProps): Promise<JSX.Element> {
  const params = await searchParams;

  // Validation
  if (params.response_type !== 'code') {
    return <ErrorPage error="unsupported_response_type" />;
  }
  if (!params.client_id || !params.redirect_uri) {
    return <ErrorPage error="invalid_request" />;
  }

  const client = await lookupClient(params.client_id);
  if (!client) {
    return <ErrorPage error="invalid_client" />;
  }

  if (!client.redirectUris.includes(params.redirect_uri)) {
    return <ErrorPage error="invalid_redirect_uri" />;
  }

  // Auth check
  const cookieStore = await cookies();
  const token = cookieStore.get('session_jwt')?.value;
  if (!token) {
    const next = `/oauth/authorize?${new URLSearchParams(params as Record<string, string>).toString()}`;
    redirect(`/cs/login?next=${encodeURIComponent(next)}`);
  }

  let userId = '';
  let userEmail = '';
  try {
    const payload = await verifyToken(token);
    userId = (payload.sub as string) ?? '';
    userEmail = (payload.email as string) ?? '';
  } catch {
    redirect('/cs/login');
  }

  const requestedScopes = params.scope ? params.scope.split(' ').filter(Boolean) : ['read_events'];
  const validScopes = requestedScopes.filter((s) => client.allowedScopes.includes(s) || client.allowedScopes.includes('*'));

  // Find promoter (pokud user je member nějakého)
  const promoter = await db().query<{ promoter_id: string }>(
    `SELECT promoter_id FROM platform.promoter_members WHERE user_id = $1 AND status = 'active' LIMIT 1`,
    [userId],
  );
  const promoterId = promoter.rows[0]?.promoter_id ?? null;

  return (
    <ConsentForm
      clientId={client.id}
      clientPublicId={client.clientId}
      appName={client.appName}
      appLogoUrl={client.appLogoUrl}
      userEmail={userEmail}
      userId={userId}
      promoterId={promoterId}
      requestedScopes={validScopes}
      redirectUri={params.redirect_uri}
      state={params.state ?? ''}
      codeChallenge={params.code_challenge ?? ''}
      codeChallengeMethod={params.code_challenge_method ?? ''}
    />
  );
}

function ErrorPage({ error }: { error: string }): JSX.Element {
  return (
    <div className="mx-auto max-w-md p-8 text-center">
      <h1 className="text-2xl font-bold text-rose-700">OAuth chyba</h1>
      <p className="mt-2 text-sm text-muted-foreground">{error}</p>
    </div>
  );
}
