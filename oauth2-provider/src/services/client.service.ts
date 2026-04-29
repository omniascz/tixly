/**
 * OAuth client registration + management.
 *
 * Clients are 3rd party integrations that want to call the API on behalf of
 * users (confidential or public). Each client has a unique client_id,
 * optional client_secret, allowed redirect URIs, and grant types.
 */
import { createHash, randomBytes } from 'crypto';
import { OAuthError } from '../lib/oauth-errors.js';

export interface OAuthDB {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export type ClientType = 'confidential' | 'public';
export type GrantType = 'authorization_code' | 'client_credentials' | 'refresh_token';

export interface OAuthClient {
  id: string;
  clientId: string;
  clientSecretHash: string | null;
  clientType: ClientType;
  name: string;
  redirectUris: string[];
  allowedGrantTypes: GrantType[];
  allowedScopes: string[];
  promoterId: string | null;
  createdAt: Date;
}

export interface RegisterClientInput {
  name: string;
  clientType: ClientType;
  redirectUris: string[];
  allowedGrantTypes: GrantType[];
  allowedScopes: string[];
  promoterId?: string;
}

export interface RegisterClientResult {
  client: OAuthClient;
  clientSecret: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateClientId(): string {
  return 'tka_' + randomBytes(16).toString('hex');
}

function generateClientSecret(): string {
  return randomBytes(32).toString('hex');
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export async function registerClient(
  input: RegisterClientInput,
  db: OAuthDB,
): Promise<RegisterClientResult> {
  if (input.redirectUris.length === 0 && input.allowedGrantTypes.includes('authorization_code')) {
    throw new OAuthError('invalid_request', 'authorization_code requires at least one redirect_uri.');
  }

  const clientId = generateClientId();
  const clientSecret = input.clientType === 'confidential' ? generateClientSecret() : null;
  const clientSecretHash = clientSecret ? hashSecret(clientSecret) : null;

  const { rows } = await db.query<OAuthClient>(
    `INSERT INTO oauth.clients
       (client_id, client_secret_hash, client_type, name, redirect_uris,
        allowed_grant_types, allowed_scopes, promoter_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, client_id AS "clientId", client_secret_hash AS "clientSecretHash",
               client_type AS "clientType", name,
               redirect_uris AS "redirectUris",
               allowed_grant_types AS "allowedGrantTypes",
               allowed_scopes AS "allowedScopes",
               promoter_id AS "promoterId", created_at AS "createdAt"`,
    [clientId, clientSecretHash, input.clientType, input.name,
     input.redirectUris, input.allowedGrantTypes, input.allowedScopes, input.promoterId ?? null],
  );

  return { client: rows[0], clientSecret };
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

export async function authenticateClient(
  clientId: string,
  clientSecret: string | null,
  db: OAuthDB,
): Promise<OAuthClient> {
  const { rows } = await db.query<OAuthClient>(
    `SELECT id, client_id AS "clientId", client_secret_hash AS "clientSecretHash",
            client_type AS "clientType", name,
            redirect_uris AS "redirectUris",
            allowed_grant_types AS "allowedGrantTypes",
            allowed_scopes AS "allowedScopes",
            promoter_id AS "promoterId", created_at AS "createdAt"
     FROM oauth.clients WHERE client_id = $1`,
    [clientId],
  );
  if (rows.length === 0) throw new OAuthError('invalid_client', 'Unknown client_id.');

  const client = rows[0];
  if (client.clientType === 'confidential') {
    if (!clientSecret) throw new OAuthError('invalid_client', 'Client secret required.');
    if (hashSecret(clientSecret) !== client.clientSecretHash) {
      throw new OAuthError('invalid_client', 'Invalid client secret.');
    }
  }
  return client;
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export async function getClientByClientId(clientId: string, db: OAuthDB): Promise<OAuthClient> {
  const { rows } = await db.query<OAuthClient>(
    `SELECT id, client_id AS "clientId", client_secret_hash AS "clientSecretHash",
            client_type AS "clientType", name,
            redirect_uris AS "redirectUris",
            allowed_grant_types AS "allowedGrantTypes",
            allowed_scopes AS "allowedScopes",
            promoter_id AS "promoterId", created_at AS "createdAt"
     FROM oauth.clients WHERE client_id = $1`,
    [clientId],
  );
  if (rows.length === 0) throw new OAuthError('invalid_client', 'Unknown client_id.');
  return rows[0];
}

export function validateRedirectUri(client: OAuthClient, redirectUri: string): void {
  if (!client.redirectUris.includes(redirectUri)) {
    throw new OAuthError('invalid_request', 'redirect_uri does not match any registered URI.');
  }
}

export function validateGrantType(client: OAuthClient, grantType: GrantType): void {
  if (!client.allowedGrantTypes.includes(grantType)) {
    throw new OAuthError('unauthorized_client', `grant_type ${grantType} not allowed for this client.`);
  }
}

export function validateScope(client: OAuthClient, requestedScope: string): string[] {
  const requested = requestedScope.split(/\s+/).filter(Boolean);
  const invalid = requested.filter((s) => !client.allowedScopes.includes(s));
  if (invalid.length > 0) {
    throw new OAuthError('invalid_scope', `Requested scopes not allowed: ${invalid.join(', ')}`);
  }
  return requested;
}
