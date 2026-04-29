/**
 * Token service — authorization codes, access tokens, refresh tokens.
 *
 * Flows supported:
 *  - Authorization Code (with PKCE) — for user-authenticated apps
 *  - Client Credentials — for server-to-server API integrations
 *  - Refresh Token — to exchange refresh for new access token
 *
 * Access tokens are opaque random strings stored in DB (not JWTs) so they
 * can be revoked. In production, consider signed JWTs + revocation list.
 */
import { randomBytes, createHash } from 'crypto';
import { OAuthError } from '../lib/oauth-errors.js';
import { verifyPkce, type PkceMethod } from '../lib/pkce.js';
import type { OAuthDB, OAuthClient, GrantType } from './client.service.js';

export interface AuthorizationCode {
  code: string;
  clientId: string;
  userId: string;
  redirectUri: string;
  scopes: string[];
  codeChallenge: string;
  codeChallengeMethod: PkceMethod;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface AccessToken {
  token: string;
  clientId: string;
  userId: string | null;
  scopes: string[];
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface RefreshToken {
  token: string;
  clientId: string;
  userId: string;
  scopes: string[];
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

const ACCESS_TOKEN_TTL_SECONDS = 3600;       // 1 hour
const REFRESH_TOKEN_TTL_SECONDS = 30 * 86400;  // 30 days
const AUTH_CODE_TTL_SECONDS = 600;           // 10 min

// ---------------------------------------------------------------------------
// Token generation helpers
// ---------------------------------------------------------------------------

function randomToken(prefix: string): string {
  return prefix + '_' + randomBytes(32).toString('hex');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ---------------------------------------------------------------------------
// Authorization Code issuance
// ---------------------------------------------------------------------------

export async function issueAuthorizationCode(
  clientId: string,
  userId: string,
  redirectUri: string,
  scopes: string[],
  codeChallenge: string,
  codeChallengeMethod: PkceMethod,
  db: OAuthDB,
): Promise<string> {
  const code = randomToken('code');
  const expiresAt = new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000);

  await db.execute(
    `INSERT INTO oauth.authorization_codes
       (code_hash, client_id, user_id, redirect_uri, scopes,
        code_challenge, code_challenge_method, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [hashToken(code), clientId, userId, redirectUri, scopes,
     codeChallenge, codeChallengeMethod, expiresAt.toISOString()],
  );

  return code;
}

// ---------------------------------------------------------------------------
// Grant: authorization_code
// ---------------------------------------------------------------------------

export async function exchangeAuthorizationCode(
  client: OAuthClient,
  code: string,
  redirectUri: string,
  codeVerifier: string,
  db: OAuthDB,
): Promise<TokenResponse> {
  // 1. Look up auth code
  const { rows } = await db.query<AuthorizationCode & { code_hash: string }>(
    `SELECT client_id AS "clientId", user_id AS "userId",
            redirect_uri AS "redirectUri", scopes,
            code_challenge AS "codeChallenge",
            code_challenge_method AS "codeChallengeMethod",
            expires_at AS "expiresAt", used_at AS "usedAt"
     FROM oauth.authorization_codes
     WHERE code_hash = $1`,
    [hashToken(code)],
  );
  if (rows.length === 0) throw new OAuthError('invalid_grant', 'Authorization code not found.');

  const authCode = rows[0];

  // 2. Validate code
  if (authCode.usedAt) throw new OAuthError('invalid_grant', 'Authorization code already used.');
  if (new Date(authCode.expiresAt) < new Date()) {
    throw new OAuthError('invalid_grant', 'Authorization code expired.');
  }
  if (authCode.clientId !== client.clientId) {
    throw new OAuthError('invalid_grant', 'Authorization code was issued to a different client.');
  }
  if (authCode.redirectUri !== redirectUri) {
    throw new OAuthError('invalid_grant', 'redirect_uri mismatch.');
  }

  // 3. Verify PKCE
  if (!verifyPkce(codeVerifier, authCode.codeChallenge, authCode.codeChallengeMethod)) {
    throw new OAuthError('invalid_grant', 'PKCE verification failed.');
  }

  // 4. Mark code as used (single-use)
  await db.execute(
    `UPDATE oauth.authorization_codes SET used_at = NOW() WHERE code_hash = $1`,
    [hashToken(code)],
  );

  // 5. Issue access token + refresh token
  return issueTokenPair(client.clientId, authCode.userId, authCode.scopes, db);
}

// ---------------------------------------------------------------------------
// Grant: client_credentials
// ---------------------------------------------------------------------------

export async function clientCredentialsGrant(
  client: OAuthClient,
  requestedScopes: string[],
  db: OAuthDB,
): Promise<TokenResponse> {
  // Client credentials tokens don't have refresh tokens
  const accessToken = randomToken('at');
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000);

  await db.execute(
    `INSERT INTO oauth.access_tokens (token_hash, client_id, user_id, scopes, expires_at)
     VALUES ($1, $2, NULL, $3, $4)`,
    [hashToken(accessToken), client.clientId, requestedScopes, expiresAt.toISOString()],
  );

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    scope: requestedScopes.join(' '),
  };
}

// ---------------------------------------------------------------------------
// Grant: refresh_token
// ---------------------------------------------------------------------------

export async function refreshTokenGrant(
  client: OAuthClient,
  refreshToken: string,
  db: OAuthDB,
): Promise<TokenResponse> {
  const { rows } = await db.query<RefreshToken>(
    `SELECT client_id AS "clientId", user_id AS "userId", scopes,
            expires_at AS "expiresAt", revoked_at AS "revokedAt"
     FROM oauth.refresh_tokens
     WHERE token_hash = $1`,
    [hashToken(refreshToken)],
  );
  if (rows.length === 0) throw new OAuthError('invalid_grant', 'Refresh token not found.');

  const rt = rows[0];
  if (rt.revokedAt) throw new OAuthError('invalid_grant', 'Refresh token revoked.');
  if (new Date(rt.expiresAt) < new Date()) throw new OAuthError('invalid_grant', 'Refresh token expired.');
  if (rt.clientId !== client.clientId) {
    throw new OAuthError('invalid_grant', 'Refresh token was issued to a different client.');
  }

  // Revoke old refresh token (rotation)
  await db.execute(
    `UPDATE oauth.refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1`,
    [hashToken(refreshToken)],
  );

  return issueTokenPair(client.clientId, rt.userId, rt.scopes, db);
}

// ---------------------------------------------------------------------------
// Shared: issue (access, refresh) token pair
// ---------------------------------------------------------------------------

async function issueTokenPair(
  clientId: string,
  userId: string,
  scopes: string[],
  db: OAuthDB,
): Promise<TokenResponse> {
  const accessToken = randomToken('at');
  const refreshToken = randomToken('rt');
  const accessExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);

  await db.execute(
    `INSERT INTO oauth.access_tokens (token_hash, client_id, user_id, scopes, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [hashToken(accessToken), clientId, userId, scopes, accessExpiresAt.toISOString()],
  );
  await db.execute(
    `INSERT INTO oauth.refresh_tokens (token_hash, client_id, user_id, scopes, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [hashToken(refreshToken), clientId, userId, scopes, refreshExpiresAt.toISOString()],
  );

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: scopes.join(' '),
  };
}

// ---------------------------------------------------------------------------
// Introspection + revocation
// ---------------------------------------------------------------------------

export async function introspectToken(
  token: string,
  db: OAuthDB,
): Promise<{ active: boolean; clientId?: string; userId?: string | null; scopes?: string[]; expiresAt?: Date }> {
  const { rows } = await db.query<{
    clientId: string; userId: string | null; scopes: string[];
    expiresAt: Date; revokedAt: Date | null;
  }>(
    `SELECT client_id AS "clientId", user_id AS "userId", scopes,
            expires_at AS "expiresAt", revoked_at AS "revokedAt"
     FROM oauth.access_tokens WHERE token_hash = $1`,
    [hashToken(token)],
  );
  if (rows.length === 0) return { active: false };

  const t = rows[0];
  if (t.revokedAt) return { active: false };
  if (new Date(t.expiresAt) < new Date()) return { active: false };

  return {
    active: true,
    clientId: t.clientId,
    userId: t.userId,
    scopes: t.scopes,
    expiresAt: t.expiresAt,
  };
}

export async function revokeToken(token: string, db: OAuthDB): Promise<boolean> {
  const hash = hashToken(token);
  const { rows: accessRows } = await db.query<{ id: string }>(
    `UPDATE oauth.access_tokens SET revoked_at = NOW()
     WHERE token_hash = $1 AND revoked_at IS NULL
     RETURNING client_id AS id`,
    [hash],
  );
  if (accessRows.length > 0) return true;

  const { rows: refreshRows } = await db.query<{ id: string }>(
    `UPDATE oauth.refresh_tokens SET revoked_at = NOW()
     WHERE token_hash = $1 AND revoked_at IS NULL
     RETURNING client_id AS id`,
    [hash],
  );
  return refreshRows.length > 0;
}
