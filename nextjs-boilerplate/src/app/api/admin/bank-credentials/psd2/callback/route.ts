/**
 * GET /api/admin/bank-credentials/psd2/callback?code=&state=
 *
 * PSD2 bank OAuth2 callback. Validate state, exchange code → token,
 * encrypt & store tokens, mark credentials active.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { encryptSecret } from '@/lib/crypto';
import { exchangeCodeForToken, type PSD2Provider } from '@/lib/bank/psd2';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function GET(req: NextRequest): Promise<Response> {
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  if (!code || !state) {
    return NextResponse.json({ error: 'MISSING_CODE_OR_STATE' }, { status: 400 });
  }

  // Find credentials by state
  const r = await db().query<{
    id: string;
    promoter_id: string;
    provider: string;
  }>(
    `SELECT id, promoter_id, provider
     FROM platform.bank_credentials
     WHERE oauth_state = $1
     LIMIT 1`,
    [state],
  );

  if (r.rows.length === 0) {
    return NextResponse.json(
      { error: 'INVALID_STATE', message: 'OAuth state nenalezen. Zkus to znova.' },
      { status: 400 },
    );
  }
  const cred = r.rows[0]!;

  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const redirectUri = `${appUrl}/api/admin/bank-credentials/psd2/callback`;

  try {
    const tokens = await exchangeCodeForToken({
      provider: cred.provider as PSD2Provider,
      code,
      redirectUri,
    });
    if (!tokens) {
      return NextResponse.json({ error: 'PROVIDER_NOT_CONFIGURED' }, { status: 503 });
    }

    const accessEnc = encryptSecret(tokens.access_token);
    const refreshEnc = tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null;
    const accessExpires = new Date(Date.now() + tokens.expires_in * 1000);
    // PSD2 consent typicky 90 dní (informational — re-auth před expirací)
    const consentExpires = new Date(Date.now() + 90 * 86400_000);

    await db().query(
      `UPDATE platform.bank_credentials
       SET access_token_encrypted = $2,
           refresh_token_encrypted = $3,
           access_token_expires_at = $4,
           consent_id = $5,
           consent_expires_at = $6,
           token_encrypted = $2,
           oauth_state = NULL,
           active = TRUE,
           last_sync_status = 'authorized',
           updated_at = NOW()
       WHERE id = $1`,
      [
        cred.id,
        accessEnc,
        refreshEnc,
        accessExpires.toISOString(),
        tokens.consent_id ?? null,
        consentExpires.toISOString(),
      ],
    );

    // Redirect zpět do admin UI
    return NextResponse.redirect(`${appUrl}/admin/bank-transfers?psd2=ok&provider=${cred.provider}`, 302);
  } catch (err) {
    console.error('[psd2 callback]', err);
    return NextResponse.json(
      {
        error: 'TOKEN_EXCHANGE_FAILED',
        message: err instanceof Error ? err.message : 'unknown',
      },
      { status: 500 },
    );
  }
}
