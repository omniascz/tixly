/**
 * BankID environment config loader with dev-mode no-op fallback.
 *
 * When any of the required env vars is missing we return `isConfigured: false`.
 * Callers (initiate / callback routes) can then short-circuit to a dev stub
 * that does not contact the real BankID OIDC provider. This allows local
 * development and CI to run without BankID credentials.
 */

export interface BankIdConfig {
  isConfigured: boolean;
  clientId:     string;
  clientSecret: string;
  authUrl:      string;
  redirectUri:  string;
  hashSalt:     string;
}

export function loadBankIdConfig(): BankIdConfig {
  const clientId     = process.env.BANKID_CLIENT_ID     ?? '';
  const clientSecret = process.env.BANKID_CLIENT_SECRET ?? '';
  const authUrl      = process.env.BANKID_AUTH_URL      ?? '';
  const redirectUri  = process.env.BANKID_REDIRECT_URI  ?? '';
  const hashSalt     = process.env.IDENTITY_HASH_SALT   ?? '';

  const isConfigured =
    clientId.length     > 0 &&
    clientSecret.length > 0 &&
    authUrl.length      > 0 &&
    redirectUri.length  > 0 &&
    hashSalt.length     >= 16;

  return { isConfigured, clientId, clientSecret, authUrl, redirectUri, hashSalt };
}

/**
 * Build a dev-mode stub authorization URL. The frontend redirects the user
 * here; the route should forward back to the callback with `?dev_user=...`.
 */
export function buildDevStubAuthUrl(redirectUri: string, state: string, devUser = 'test123'): string {
  const params = new URLSearchParams({ state, dev_user: devUser });
  return `${redirectUri}?${params.toString()}`;
}
