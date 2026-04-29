import { describe, it, expect, vi } from 'vitest';
import { verifyPkce, generateCodeVerifier, generateCodeChallenge } from '../lib/pkce.js';
import {
  registerClient, authenticateClient, getClientByClientId,
  validateRedirectUri, validateGrantType, validateScope,
} from '../services/client.service.js';
import {
  issueAuthorizationCode, exchangeAuthorizationCode,
  clientCredentialsGrant, refreshTokenGrant,
  introspectToken, revokeToken,
} from '../services/token.service.js';
import { OAuthError, isOAuthError } from '../lib/oauth-errors.js';

function makeDb(rows: unknown[][] = []) {
  let idx = 0;
  return {
    query: vi.fn().mockImplementation(() => Promise.resolve({ rows: rows[idx++] ?? [] })),
    execute: vi.fn().mockResolvedValue(undefined),
  };
}

const CLIENT = {
  id: 'c-uuid',
  clientId: 'tka_client_1',
  clientSecretHash: null as string | null,
  clientType: 'confidential' as const,
  name: 'Test Client',
  redirectUris: ['https://app.example.com/callback'],
  allowedGrantTypes: ['authorization_code', 'client_credentials', 'refresh_token'] as ('authorization_code' | 'client_credentials' | 'refresh_token')[],
  allowedScopes: ['read:tickets', 'write:orders'],
  promoterId: 'p-1',
  createdAt: new Date(),
};

// ---------------------------------------------------------------------------
// PKCE
// ---------------------------------------------------------------------------
describe('PKCE', () => {
  it('generates a valid verifier', () => {
    const v = generateCodeVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
  });

  it('verifies S256 challenge', () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier, 'S256');
    expect(verifyPkce(verifier, challenge, 'S256')).toBe(true);
  });

  it('rejects wrong verifier for S256', () => {
    const v1 = generateCodeVerifier();
    const v2 = generateCodeVerifier();
    const challenge = generateCodeChallenge(v1, 'S256');
    expect(verifyPkce(v2, challenge, 'S256')).toBe(false);
  });

  it('verifies plain challenge (verifier === challenge)', () => {
    const verifier = 'a'.repeat(43);
    expect(verifyPkce(verifier, verifier, 'plain')).toBe(true);
  });

  it('rejects mismatched plain', () => {
    const v1 = 'a'.repeat(43);
    const v2 = 'b'.repeat(43);
    expect(verifyPkce(v1, v2, 'plain')).toBe(false);
  });

  it('rejects too-short verifier', () => {
    expect(verifyPkce('short', 'short', 'plain')).toBe(false);
  });

  it('rejects too-long verifier', () => {
    const long = 'a'.repeat(200);
    expect(verifyPkce(long, long, 'plain')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Client registration + authentication
// ---------------------------------------------------------------------------
describe('registerClient', () => {
  it('registers a confidential client with generated secret', async () => {
    const db = makeDb([[{ ...CLIENT, clientSecretHash: 'some-hash' }]]);
    const result = await registerClient({
      name: 'Test', clientType: 'confidential',
      redirectUris: ['https://app.example.com/callback'],
      allowedGrantTypes: ['authorization_code'],
      allowedScopes: ['read:tickets'],
    }, db);
    expect(result.clientSecret).not.toBeNull();
    expect(result.clientSecret?.length).toBeGreaterThanOrEqual(64);
    expect(result.client.clientId).toMatch(/^tka_/);
  });

  it('registers public client without secret', async () => {
    const db = makeDb([[{ ...CLIENT, clientType: 'public', clientSecretHash: null }]]);
    const result = await registerClient({
      name: 'Mobile',
      clientType: 'public',
      redirectUris: ['https://app.example.com/callback'],
      allowedGrantTypes: ['authorization_code'],
      allowedScopes: ['read:tickets'],
    }, db);
    expect(result.clientSecret).toBeNull();
  });

  it('rejects authorization_code grant without redirect_uris', async () => {
    const db = makeDb();
    await expect(registerClient({
      name: 'Bad', clientType: 'confidential',
      redirectUris: [], allowedGrantTypes: ['authorization_code'], allowedScopes: [],
    }, db)).rejects.toThrow(OAuthError);
  });
});

describe('authenticateClient', () => {
  it('authenticates confidential client with correct secret', async () => {
    const { createHash } = await import('crypto');
    const secret = 'test-secret-123';
    const hash = createHash('sha256').update(secret).digest('hex');
    const db = makeDb([[{ ...CLIENT, clientSecretHash: hash }]]);
    const c = await authenticateClient(CLIENT.clientId, secret, db);
    expect(c.clientId).toBe(CLIENT.clientId);
  });

  it('rejects wrong secret', async () => {
    const { createHash } = await import('crypto');
    const hash = createHash('sha256').update('real').digest('hex');
    const db = makeDb([[{ ...CLIENT, clientSecretHash: hash }]]);
    await expect(authenticateClient(CLIENT.clientId, 'wrong', db))
      .rejects.toMatchObject({ code: 'invalid_client' });
  });

  it('rejects unknown client', async () => {
    const db = makeDb([[]]);
    await expect(authenticateClient('unknown', 'any', db))
      .rejects.toMatchObject({ code: 'invalid_client' });
  });
});

describe('validateRedirectUri + validateGrantType + validateScope', () => {
  it('accepts registered redirect_uri', () => {
    expect(() => validateRedirectUri(CLIENT, 'https://app.example.com/callback')).not.toThrow();
  });
  it('rejects unregistered redirect_uri', () => {
    expect(() => validateRedirectUri(CLIENT, 'https://evil.com/callback')).toThrow(OAuthError);
  });
  it('accepts allowed grant type', () => {
    expect(() => validateGrantType(CLIENT, 'authorization_code')).not.toThrow();
  });
  it('rejects disallowed grant type', () => {
    const c2 = { ...CLIENT, allowedGrantTypes: ['client_credentials'] as any };
    expect(() => validateGrantType(c2, 'authorization_code')).toThrow(OAuthError);
  });
  it('filters scopes to allowed subset', () => {
    const r = validateScope(CLIENT, 'read:tickets');
    expect(r).toEqual(['read:tickets']);
  });
  it('rejects scopes not in allowed list', () => {
    expect(() => validateScope(CLIENT, 'read:tickets admin')).toThrow(OAuthError);
  });
});

// ---------------------------------------------------------------------------
// Authorization Code flow
// ---------------------------------------------------------------------------
describe('issueAuthorizationCode + exchange', () => {
  it('issues and exchanges code with valid PKCE S256', async () => {
    const db = makeDb();
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier, 'S256');

    // Issue
    const code = await issueAuthorizationCode(
      CLIENT.clientId, 'user-1', CLIENT.redirectUris[0], ['read:tickets'],
      challenge, 'S256', db,
    );
    expect(code).toMatch(/^code_/);
    expect(db.execute).toHaveBeenCalledOnce();

    // Mock exchange: DB returns the issued code
    const exchangeDb = makeDb([
      [{
        clientId: CLIENT.clientId,
        userId: 'user-1',
        redirectUri: CLIENT.redirectUris[0],
        scopes: ['read:tickets'],
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
        expiresAt: new Date(Date.now() + 600_000),
        usedAt: null,
      }],
    ]);
    const tokens = await exchangeAuthorizationCode(
      CLIENT, code, CLIENT.redirectUris[0], verifier, exchangeDb,
    );
    expect(tokens.access_token).toMatch(/^at_/);
    expect(tokens.refresh_token).toMatch(/^rt_/);
    expect(tokens.scope).toBe('read:tickets');
    expect(tokens.token_type).toBe('Bearer');
  });

  it('rejects wrong PKCE verifier', async () => {
    const verifier = generateCodeVerifier();
    const badVerifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier, 'S256');
    const db = makeDb([
      [{
        clientId: CLIENT.clientId, userId: 'u1', redirectUri: CLIENT.redirectUris[0],
        scopes: ['read:tickets'], codeChallenge: challenge, codeChallengeMethod: 'S256',
        expiresAt: new Date(Date.now() + 600_000), usedAt: null,
      }],
    ]);
    await expect(exchangeAuthorizationCode(CLIENT, 'code_x', CLIENT.redirectUris[0], badVerifier, db))
      .rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('rejects expired code', async () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier, 'S256');
    const db = makeDb([
      [{
        clientId: CLIENT.clientId, userId: 'u1', redirectUri: CLIENT.redirectUris[0],
        scopes: [], codeChallenge: challenge, codeChallengeMethod: 'S256',
        expiresAt: new Date(Date.now() - 1000), usedAt: null,
      }],
    ]);
    await expect(exchangeAuthorizationCode(CLIENT, 'code_x', CLIENT.redirectUris[0], verifier, db))
      .rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('rejects already-used code', async () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier, 'S256');
    const db = makeDb([
      [{
        clientId: CLIENT.clientId, userId: 'u1', redirectUri: CLIENT.redirectUris[0],
        scopes: [], codeChallenge: challenge, codeChallengeMethod: 'S256',
        expiresAt: new Date(Date.now() + 600_000), usedAt: new Date(),
      }],
    ]);
    await expect(exchangeAuthorizationCode(CLIENT, 'code_x', CLIENT.redirectUris[0], verifier, db))
      .rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('rejects redirect_uri mismatch', async () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier, 'S256');
    const db = makeDb([
      [{
        clientId: CLIENT.clientId, userId: 'u1', redirectUri: CLIENT.redirectUris[0],
        scopes: [], codeChallenge: challenge, codeChallengeMethod: 'S256',
        expiresAt: new Date(Date.now() + 600_000), usedAt: null,
      }],
    ]);
    await expect(exchangeAuthorizationCode(CLIENT, 'code_x', 'https://evil.com/cb', verifier, db))
      .rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('rejects code issued to different client', async () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier, 'S256');
    const db = makeDb([
      [{
        clientId: 'other_client', userId: 'u1', redirectUri: CLIENT.redirectUris[0],
        scopes: [], codeChallenge: challenge, codeChallengeMethod: 'S256',
        expiresAt: new Date(Date.now() + 600_000), usedAt: null,
      }],
    ]);
    await expect(exchangeAuthorizationCode(CLIENT, 'code_x', CLIENT.redirectUris[0], verifier, db))
      .rejects.toMatchObject({ code: 'invalid_grant' });
  });
});

// ---------------------------------------------------------------------------
// Client credentials flow
// ---------------------------------------------------------------------------
describe('clientCredentialsGrant', () => {
  it('issues access token without refresh token', async () => {
    const db = makeDb();
    const tokens = await clientCredentialsGrant(CLIENT, ['read:tickets'], db);
    expect(tokens.access_token).toMatch(/^at_/);
    expect(tokens.refresh_token).toBeUndefined();
    expect(tokens.scope).toBe('read:tickets');
    expect(tokens.expires_in).toBe(3600);
  });
});

// ---------------------------------------------------------------------------
// Refresh token flow
// ---------------------------------------------------------------------------
describe('refreshTokenGrant', () => {
  it('exchanges valid refresh token for new pair', async () => {
    const db = makeDb([
      [{
        clientId: CLIENT.clientId, userId: 'u1', scopes: ['read:tickets'],
        expiresAt: new Date(Date.now() + 30 * 86400000), revokedAt: null,
      }],
    ]);
    const tokens = await refreshTokenGrant(CLIENT, 'rt_old', db);
    expect(tokens.access_token).toMatch(/^at_/);
    expect(tokens.refresh_token).toMatch(/^rt_/);
  });

  it('rejects revoked refresh token', async () => {
    const db = makeDb([
      [{
        clientId: CLIENT.clientId, userId: 'u1', scopes: [],
        expiresAt: new Date(Date.now() + 86400000), revokedAt: new Date(),
      }],
    ]);
    await expect(refreshTokenGrant(CLIENT, 'rt_x', db))
      .rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('rejects expired refresh token', async () => {
    const db = makeDb([
      [{
        clientId: CLIENT.clientId, userId: 'u1', scopes: [],
        expiresAt: new Date(Date.now() - 1000), revokedAt: null,
      }],
    ]);
    await expect(refreshTokenGrant(CLIENT, 'rt_x', db))
      .rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('rejects refresh token from different client', async () => {
    const db = makeDb([
      [{
        clientId: 'other_client', userId: 'u1', scopes: [],
        expiresAt: new Date(Date.now() + 86400000), revokedAt: null,
      }],
    ]);
    await expect(refreshTokenGrant(CLIENT, 'rt_x', db))
      .rejects.toMatchObject({ code: 'invalid_grant' });
  });
});

// ---------------------------------------------------------------------------
// Introspection + revocation
// ---------------------------------------------------------------------------
describe('introspectToken', () => {
  it('returns active=true for valid token', async () => {
    const db = makeDb([
      [{
        clientId: CLIENT.clientId, userId: 'u1', scopes: ['read:tickets'],
        expiresAt: new Date(Date.now() + 3600000), revokedAt: null,
      }],
    ]);
    const r = await introspectToken('at_x', db);
    expect(r.active).toBe(true);
    expect(r.scopes).toEqual(['read:tickets']);
  });

  it('returns active=false for expired token', async () => {
    const db = makeDb([
      [{
        clientId: CLIENT.clientId, userId: 'u1', scopes: [],
        expiresAt: new Date(Date.now() - 1000), revokedAt: null,
      }],
    ]);
    const r = await introspectToken('at_x', db);
    expect(r.active).toBe(false);
  });

  it('returns active=false for revoked token', async () => {
    const db = makeDb([
      [{
        clientId: CLIENT.clientId, userId: 'u1', scopes: [],
        expiresAt: new Date(Date.now() + 3600000), revokedAt: new Date(),
      }],
    ]);
    const r = await introspectToken('at_x', db);
    expect(r.active).toBe(false);
  });

  it('returns active=false for unknown token', async () => {
    const db = makeDb([[]]);
    const r = await introspectToken('at_x', db);
    expect(r.active).toBe(false);
  });
});

describe('revokeToken', () => {
  it('revokes access token', async () => {
    const db = makeDb([[{ id: CLIENT.clientId }]]);
    expect(await revokeToken('at_x', db)).toBe(true);
  });

  it('falls through to refresh token if not access', async () => {
    const db = makeDb([
      [],   // access_tokens update returned nothing
      [{ id: CLIENT.clientId }],  // refresh_tokens update returned row
    ]);
    expect(await revokeToken('rt_x', db)).toBe(true);
  });

  it('returns false for unknown token', async () => {
    const db = makeDb([[], []]);
    expect(await revokeToken('unknown', db)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OAuthError
// ---------------------------------------------------------------------------
describe('OAuthError', () => {
  it('maps codes to RFC status codes', () => {
    expect(new OAuthError('invalid_client', 'x').statusCode).toBe(401);
    expect(new OAuthError('invalid_grant', 'x').statusCode).toBe(400);
    expect(new OAuthError('unauthorized_client', 'x').statusCode).toBe(403);
  });
  it('type guard works', () => {
    expect(isOAuthError(new OAuthError('invalid_request', 'x'))).toBe(true);
    expect(isOAuthError(new Error())).toBe(false);
  });
  it('serializes to RFC 6749 error format', () => {
    const err = new OAuthError('invalid_request', 'Missing code');
    expect(err.toHttpError()).toEqual({ error: 'invalid_request', error_description: 'Missing code' });
  });
});
