/**
 * GET /api/admin/bank-credentials/psd2/authorize?provider=kb_psd2
 *
 * Začne PSD2 OAuth2 flow — vygeneruje state, redirectuje promotéra na banku.
 * Po úspěšné autorizaci bank redirectuje na /api/admin/bank-credentials/psd2/callback.
 */

import { randomBytes } from 'crypto';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { NextRequest, NextResponse } from 'next/server';
import { buildAuthorizeUrl, type PSD2Provider } from '@/lib/bank/psd2';


const VALID_PROVIDERS: PSD2Provider[] = ['kb_psd2', 'cs_psd2', 'csob_psd2'];

export async function GET(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
  const provider = req.nextUrl.searchParams.get('provider') as PSD2Provider | null;
  if (!provider || !VALID_PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: 'INVALID_PROVIDER' }, { status: 422 });
  }

  // Upsert bank_credentials row s ephemeral state
  const state = randomBytes(32).toString('base64url');
  await db().query(
    `INSERT INTO platform.bank_credentials (promoter_id, provider, token_encrypted, oauth_state, active)
     VALUES ($1, $2, '', $3, FALSE)
     ON CONFLICT (promoter_id, provider)
     DO UPDATE SET oauth_state = $3, updated_at = NOW()`,
    [promoter.promoterId, provider, state],
  );

  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const redirectUri = `${appUrl}/api/admin/bank-credentials/psd2/callback`;
  const authUrl = buildAuthorizeUrl({ provider, redirectUri, state });

  if (!authUrl) {
    return NextResponse.json(
      {
        error: 'PROVIDER_NOT_CONFIGURED',
        message: `${provider} client_id env není nastaven. Setup v ENV.`,
      },
      { status: 503 },
    );
  }

  return NextResponse.redirect(authUrl, 302);

  });
}
