/**
 * OAuth 2.0 helper functions.
 *
 * Flow:
 *   1. App owner registruje client → dostane client_id + client_secret
 *   2. User klikne "Connect Tixly" → /oauth/authorize?client_id=..&redirect_uri=..&scope=..
 *   3. User schválí → server vrátí code v redirect_uri
 *   4. App vymění code za access_token přes POST /oauth/token
 *   5. App používá Bearer access_token v /api/v3/*
 *   6. Po expiry: refresh_token → nový access_token
 *
 * Supports PKCE (S256) pro public clients (mobile/SPA).
 */
import crypto from 'node:crypto';
import { db } from '@/lib/db/rls-pool';


const ACCESS_TOKEN_PREFIX = 'tk_';
const REFRESH_TOKEN_PREFIX = 'rt_';
const ACCESS_TOKEN_TTL_SECONDS = 3600;        // 1 hour
// Refresh token TTL: 90 days (drženo v DB default na oauth_refresh_tokens.expires_at)

export function generateClientId(): string {
  return `tixly_app_${crypto.randomBytes(12).toString('hex')}`;
}

export function generateClientSecret(): string {
  return `sk_${crypto.randomBytes(32).toString('hex')}`;
}

export function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

export function generateAuthCode(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function generateAccessToken(): string {
  return `${ACCESS_TOKEN_PREFIX}${crypto.randomBytes(32).toString('hex')}`;
}

export function generateRefreshToken(): string {
  return `${REFRESH_TOKEN_PREFIX}${crypto.randomBytes(32).toString('hex')}`;
}

export interface ClientInfo {
  id: string;
  clientId: string;
  appName: string;
  appLogoUrl: string | null;
  redirectUris: string[];
  allowedScopes: string[];
  status: string;
}

export async function lookupClient(clientId: string): Promise<ClientInfo | null> {
  const r = await db().query<{
    id: string;
    client_id: string;
    app_name: string;
    app_logo_url: string | null;
    redirect_uris: string[];
    allowed_scopes: string[];
    status: string;
  }>(
    `SELECT id, client_id, app_name, app_logo_url, redirect_uris, allowed_scopes, status
       FROM b2b.oauth_clients
      WHERE client_id = $1`,
    [clientId],
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  if (row.status !== 'active') return null;
  return {
    id: row.id, clientId: row.client_id, appName: row.app_name,
    appLogoUrl: row.app_logo_url, redirectUris: row.redirect_uris,
    allowedScopes: row.allowed_scopes, status: row.status,
  };
}

export async function verifyClientSecret(clientId: string, clientSecret: string): Promise<ClientInfo | null> {
  const client = await lookupClient(clientId);
  if (!client) return null;
  const hash = hashSecret(clientSecret);
  const r = await db().query(
    `SELECT 1 FROM b2b.oauth_clients WHERE id = $1 AND client_secret_hash = $2`,
    [client.id, hash],
  );
  return r.rows.length > 0 ? client : null;
}

export interface IssueCodeInput {
  clientPkId: string;
  userId: string;
  promoterId: string | null;
  redirectUri: string;
  scopes: string[];
  codeChallenge?: string;
  codeChallengeMethod?: 'S256' | 'plain';
}

export async function issueAuthCode(input: IssueCodeInput): Promise<{ code: string; expiresIn: number }> {
  const code = generateAuthCode();
  await db().query(
    `INSERT INTO b2b.oauth_authorization_codes
       (code, client_id, user_id, promoter_id, redirect_uri, scopes, code_challenge, code_challenge_method)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      code, input.clientPkId, input.userId, input.promoterId,
      input.redirectUri, input.scopes,
      input.codeChallenge ?? null, input.codeChallengeMethod ?? null,
    ],
  );
  return { code, expiresIn: 600 };
}

export interface ExchangeCodeInput {
  code: string;
  clientPkId: string;
  redirectUri: string;
  codeVerifier?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scopes: string[];
  userId: string;
  promoterId: string | null;
}

export async function exchangeCodeForTokens(input: ExchangeCodeInput): Promise<TokenPair | { error: string }> {
  const r = await db().query<{
    code: string; client_id: string; user_id: string; promoter_id: string | null;
    redirect_uri: string; scopes: string[];
    code_challenge: string | null; code_challenge_method: string | null;
    expires_at: string; consumed_at: string | null;
  }>(
    `SELECT * FROM b2b.oauth_authorization_codes WHERE code = $1 FOR UPDATE`,
    [input.code],
  );

  if (r.rows.length === 0) return { error: 'invalid_grant' };
  const ac = r.rows[0];

  if (ac.consumed_at) return { error: 'code_already_used' };
  if (new Date(ac.expires_at) < new Date()) return { error: 'expired' };
  if (ac.client_id !== input.clientPkId) return { error: 'client_mismatch' };
  if (ac.redirect_uri !== input.redirectUri) return { error: 'redirect_uri_mismatch' };

  // PKCE check
  if (ac.code_challenge && ac.code_challenge_method) {
    if (!input.codeVerifier) return { error: 'pkce_required' };
    if (ac.code_challenge_method === 'S256') {
      const computed = crypto.createHash('sha256').update(input.codeVerifier).digest('base64url');
      if (computed !== ac.code_challenge) return { error: 'pkce_mismatch' };
    } else if (ac.code_challenge_method === 'plain') {
      if (input.codeVerifier !== ac.code_challenge) return { error: 'pkce_mismatch' };
    }
  }

  // Consume code
  await db().query(
    `UPDATE b2b.oauth_authorization_codes SET consumed_at = now() WHERE code = $1`,
    [input.code],
  );

  // Issue tokens
  const accessToken = generateAccessToken();
  const refreshToken = generateRefreshToken();
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000);

  const accessRes = await db().query<{ id: string }>(
    `INSERT INTO b2b.oauth_access_tokens
       (token_hash, client_id, user_id, promoter_id, scopes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [hashSecret(accessToken), ac.client_id, ac.user_id, ac.promoter_id, ac.scopes, expiresAt.toISOString()],
  );

  await db().query(
    `INSERT INTO b2b.oauth_refresh_tokens
       (token_hash, access_token_id, client_id, user_id, promoter_id, scopes)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [hashSecret(refreshToken), accessRes.rows[0].id, ac.client_id, ac.user_id, ac.promoter_id, ac.scopes],
  );

  return {
    accessToken, refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    scopes: ac.scopes,
    userId: ac.user_id,
    promoterId: ac.promoter_id,
  };
}

export async function refreshAccessToken(refreshToken: string, clientPkId: string): Promise<TokenPair | { error: string }> {
  const hash = hashSecret(refreshToken);
  const r = await db().query<{
    id: string; client_id: string; user_id: string; promoter_id: string | null;
    scopes: string[]; expires_at: string; revoked_at: string | null;
  }>(
    `SELECT id, client_id, user_id, promoter_id, scopes, expires_at::text, revoked_at::text
       FROM b2b.oauth_refresh_tokens WHERE token_hash = $1`,
    [hash],
  );

  if (r.rows.length === 0) return { error: 'invalid_refresh_token' };
  const rt = r.rows[0];

  if (rt.revoked_at) return { error: 'refresh_token_revoked' };
  if (new Date(rt.expires_at) < new Date()) return { error: 'refresh_token_expired' };
  if (rt.client_id !== clientPkId) return { error: 'client_mismatch' };

  // Rotate: revoke old, issue new
  const newAccess = generateAccessToken();
  const newRefresh = generateRefreshToken();
  const newExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000);

  const accessRes = await db().query<{ id: string }>(
    `INSERT INTO b2b.oauth_access_tokens
       (token_hash, client_id, user_id, promoter_id, scopes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [hashSecret(newAccess), rt.client_id, rt.user_id, rt.promoter_id, rt.scopes, newExpiresAt.toISOString()],
  );

  const newRefreshRes = await db().query<{ id: string }>(
    `INSERT INTO b2b.oauth_refresh_tokens
       (token_hash, access_token_id, client_id, user_id, promoter_id, scopes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [hashSecret(newRefresh), accessRes.rows[0].id, rt.client_id, rt.user_id, rt.promoter_id, rt.scopes],
  );

  await db().query(
    `UPDATE b2b.oauth_refresh_tokens
        SET revoked_at = now(), rotated_to_id = $2
      WHERE id = $1`,
    [rt.id, newRefreshRes.rows[0].id],
  );

  return {
    accessToken: newAccess, refreshToken: newRefresh,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    scopes: rt.scopes,
    userId: rt.user_id,
    promoterId: rt.promoter_id,
  };
}

export interface AccessTokenContext {
  clientPkId: string;
  userId: string | null;
  promoterId: string | null;
  scopes: string[];
}

export async function verifyAccessToken(token: string): Promise<AccessTokenContext | null> {
  if (!token.startsWith(ACCESS_TOKEN_PREFIX)) return null;
  const hash = hashSecret(token);
  const r = await db().query<{
    id: string; client_id: string; user_id: string | null; promoter_id: string | null;
    scopes: string[]; expires_at: string; revoked_at: string | null;
  }>(
    `SELECT id, client_id, user_id, promoter_id, scopes, expires_at::text, revoked_at::text
       FROM b2b.oauth_access_tokens WHERE token_hash = $1`,
    [hash],
  );

  if (r.rows.length === 0) return null;
  const at = r.rows[0];
  if (at.revoked_at) return null;
  if (new Date(at.expires_at) < new Date()) return null;

  // Update last_used_at async
  void db().query(`UPDATE b2b.oauth_access_tokens SET last_used_at = now() WHERE id = $1`, [at.id]);

  return {
    clientPkId: at.client_id, userId: at.user_id, promoterId: at.promoter_id, scopes: at.scopes,
  };
}

export function hasScope(ctx: AccessTokenContext, required: string): boolean {
  return ctx.scopes.includes(required) || ctx.scopes.includes('*');
}
