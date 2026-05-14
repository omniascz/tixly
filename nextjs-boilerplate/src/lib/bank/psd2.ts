/**
 * PSD2 OAuth2 generic client — KB / ČSOB / ČS Erste.
 *
 * Standardní OAuth2 Authorization Code Flow:
 *   1. Redirect user na bank authorize URL s state + redirect_uri
 *   2. User se přihlásí v bankovní app
 *   3. Bank redirectuje na naše callback URL s ?code=
 *   4. Server exchange code → access_token + refresh_token + consent_id
 *   5. Cron pulluje transactions přes access_token, refresh dle expiry
 *
 * Production gotchas:
 *   - eIDAS QWAC certificate povinný (CZ banky)
 *   - Consent expiry 90 dní → notify user pro re-auth
 *   - Rate limiting per consent (~4 calls/day)
 *   - mTLS na některé endpoints
 *
 * Tixly fáze 1 → použít sandbox API. Produkce vyžaduje:
 *   - banking license OR partnership s licensed AISP provider
 *   - QWAC cert ($500-2000/year)
 *   - registration na bank developer portal
 */

export type PSD2Provider = 'kb_psd2' | 'cs_psd2' | 'csob_psd2';

interface ProviderConfig {
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  accountsUrl: string;
  scope: string;
  clientIdEnv: string;
  clientSecretEnv: string;
}

const PROVIDERS: Record<PSD2Provider, ProviderConfig> = {
  kb_psd2: {
    name: 'Komerční banka',
    authorizeUrl: 'https://api.kb.cz/api/open/oauth2/authorize',
    tokenUrl: 'https://api.kb.cz/api/open/oauth2/token',
    accountsUrl: 'https://api.kb.cz/open/api/aisp/v2/accounts',
    scope: 'AISP',
    clientIdEnv: 'KB_PSD2_CLIENT_ID',
    clientSecretEnv: 'KB_PSD2_CLIENT_SECRET',
  },
  cs_psd2: {
    name: 'Česká spořitelna (Erste)',
    authorizeUrl: 'https://webapi.developers.erstegroup.com/api/csas/public/sandbox/v3/oauth2/authorize',
    tokenUrl: 'https://webapi.developers.erstegroup.com/api/csas/public/sandbox/v3/oauth2/token',
    accountsUrl: 'https://webapi.developers.erstegroup.com/api/csas/public/sandbox/v3/aisp/accounts',
    scope: 'AISP',
    clientIdEnv: 'CS_PSD2_CLIENT_ID',
    clientSecretEnv: 'CS_PSD2_CLIENT_SECRET',
  },
  csob_psd2: {
    name: 'ČSOB',
    authorizeUrl: 'https://api.csob.cz/psd2/api/v2/oauth2/authorize',
    tokenUrl: 'https://api.csob.cz/psd2/api/v2/oauth2/token',
    accountsUrl: 'https://api.csob.cz/psd2/api/v2/accounts',
    scope: 'AISP',
    clientIdEnv: 'CSOB_PSD2_CLIENT_ID',
    clientSecretEnv: 'CSOB_PSD2_CLIENT_SECRET',
  },
};

export function getProvider(provider: PSD2Provider): ProviderConfig {
  return PROVIDERS[provider];
}

export function buildAuthorizeUrl(input: {
  provider: PSD2Provider;
  redirectUri: string;
  state: string;
}): string | null {
  const cfg = PROVIDERS[input.provider];
  const clientId = process.env[cfg.clientIdEnv];
  if (!clientId) return null;
  const url = new URL(cfg.authorizeUrl);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', cfg.scope);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', input.state);
  return url.toString();
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  consent_id?: string;
}

export async function exchangeCodeForToken(input: {
  provider: PSD2Provider;
  code: string;
  redirectUri: string;
}): Promise<TokenResponse | null> {
  const cfg = PROVIDERS[input.provider];
  const clientId = process.env[cfg.clientIdEnv];
  const clientSecret = process.env[cfg.clientSecretEnv];
  if (!clientId || !clientSecret) return null;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`${cfg.name} token exchange HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function refreshAccessToken(input: {
  provider: PSD2Provider;
  refreshToken: string;
}): Promise<TokenResponse | null> {
  const cfg = PROVIDERS[input.provider];
  const clientId = process.env[cfg.clientIdEnv];
  const clientSecret = process.env[cfg.clientSecretEnv];
  if (!clientId || !clientSecret) return null;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`${cfg.name} refresh HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as TokenResponse;
}

export interface PSD2Transaction {
  bookingDate: string;
  amount: { value: number; currency: string };
  remittanceInformationUnstructured?: string;
  creditorName?: string;
  debtorName?: string;
  variableSymbol?: string;
}

/**
 * Fetch accounts + recent transactions přes AISP API.
 * Vrátí flat list pro pairing s VS.
 */
export async function fetchAisp(input: {
  provider: PSD2Provider;
  accessToken: string;
  consentId?: string;
}): Promise<PSD2Transaction[]> {
  const cfg = PROVIDERS[input.provider];
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.accessToken}`,
    'Content-Type': 'application/json',
  };
  if (input.consentId) headers['Consent-ID'] = input.consentId;

  // Step 1: list accounts
  const accRes = await fetch(cfg.accountsUrl, { headers });
  if (!accRes.ok) {
    throw new Error(`${cfg.name} accounts HTTP ${accRes.status}`);
  }
  const accJson = (await accRes.json()) as { accounts?: Array<{ resourceId?: string; id?: string }> };
  const accounts = accJson.accounts ?? [];

  const all: PSD2Transaction[] = [];
  for (const acc of accounts) {
    const accId = acc.resourceId ?? acc.id;
    if (!accId) continue;
    const txRes = await fetch(`${cfg.accountsUrl}/${accId}/transactions?bookingStatus=booked`, {
      headers,
    });
    if (!txRes.ok) continue;
    const txJson = (await txRes.json()) as {
      transactions?: { booked?: PSD2Transaction[] };
    };
    const booked = txJson.transactions?.booked ?? [];
    all.push(...booked);
  }
  return all;
}
