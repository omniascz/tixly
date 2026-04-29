/**
 * BankID service — unit tests
 *
 * Strategy:
 *  - All external I/O (DB, Redis, fetch) is mocked via IdentityDeps.
 *  - process.env.IDENTITY_ENCRYPTION_KEY is set to a deterministic test key.
 *  - process.env.BANKID_* are set to test values.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  initiateVerification,
  handleCallback,
  getVerificationStatus,
  type IdentityDeps,
} from '../services/bankid.service.js';
import { encryptPii, decryptPii } from '../lib/identity-crypto.js';
import { IdentityError, IdentityErrorCode } from '../lib/identity-errors.js';

// ---------------------------------------------------------------------------
// Test environment setup
// ---------------------------------------------------------------------------

// 64-char hex = 32 bytes → valid AES-256 key
const TEST_KEY = 'a'.repeat(64);

beforeEach(() => {
  process.env.IDENTITY_ENCRYPTION_KEY = TEST_KEY;
  process.env.BANKID_CLIENT_ID        = 'test-client-id';
  process.env.BANKID_CLIENT_SECRET    = 'test-client-secret';
  process.env.BANKID_REDIRECT_URI     = 'https://tixly.cz/api/identity/bankid/callback';
  process.env.BANKID_ISSUER_URL       = 'https://oidc.bankid.cz';
});

// ---------------------------------------------------------------------------
// Helpers to build mock deps
// ---------------------------------------------------------------------------

function buildMockDeps(overrides: Partial<IdentityDeps> = {}): IdentityDeps {
  const db: IdentityDeps['db'] = {
    query:   vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
  };

  const redis: IdentityDeps['redis'] = {
    setex: vi.fn().mockResolvedValue(undefined),
    get:   vi.fn().mockResolvedValue(null),
    del:   vi.fn().mockResolvedValue(undefined),
  };

  return { db, redis, ...overrides };
}

// Build a minimal valid id_token payload encoded as a JWT (unsigned — for test)
function buildFakeIdToken(payload: Record<string, unknown>): string {
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body    = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fakesig`;
}

// Build a fake userinfo response
function buildUserinfo(overrides: Record<string, unknown> = {}) {
  return {
    sub:         'bankid-sub-12345',
    iss:         'https://oidc.bankid.cz',
    given_name:  'Jan',
    family_name: 'Novák',
    birthdate:   '1990-06-15',
    acr:         'loa2',
    idcards:     [{ type: 'ID', expiry_date: '2030-01-01' }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// encryptPii / decryptPii
// ---------------------------------------------------------------------------

describe('encryptPii / decryptPii', () => {
  it('round-trips a short string', () => {
    const plain = 'Jan';
    expect(decryptPii(encryptPii(plain))).toBe(plain);
  });

  it('round-trips a longer string', () => {
    const plain = 'Příliš žluťoučký kůň úpěl ďábelské ódy — 1234567890';
    expect(decryptPii(encryptPii(plain))).toBe(plain);
  });

  it('round-trips a date string', () => {
    const plain = '1990-06-15';
    expect(decryptPii(encryptPii(plain))).toBe(plain);
  });

  it('produces different ciphertext on each call (random IV)', () => {
    const plain = 'same input';
    const enc1  = encryptPii(plain);
    const enc2  = encryptPii(plain);
    expect(enc1).not.toBe(enc2);
    // Both decrypt to original
    expect(decryptPii(enc1)).toBe(plain);
    expect(decryptPii(enc2)).toBe(plain);
  });

  it('throws when encryption key is missing', () => {
    delete process.env.IDENTITY_ENCRYPTION_KEY;
    expect(() => encryptPii('test')).toThrow(IdentityError);
    process.env.IDENTITY_ENCRYPTION_KEY = TEST_KEY;
  });

  it('throws on tampered ciphertext', () => {
    const enc    = encryptPii('sensitive data');
    const buf    = Buffer.from(enc, 'base64');
    buf[buf.length - 1] ^= 0xff;  // flip last byte of auth tag
    const tampered = buf.toString('base64');
    expect(() => decryptPii(tampered)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// initiateVerification
// ---------------------------------------------------------------------------

describe('initiateVerification', () => {
  it('returns an authUrl and state', async () => {
    const deps   = buildMockDeps();
    const result = await initiateVerification('user-uuid-1', '/dashboard', deps);

    expect(result.authUrl).toContain('https://oidc.bankid.cz/oauth2/authorize');
    expect(result.state).toBeTruthy();
    expect(result.state.length).toBeGreaterThan(20);
  });

  it('includes required PKCE and OIDC params in authUrl', async () => {
    const deps   = buildMockDeps();
    const result = await initiateVerification('user-uuid-1', '/dashboard', deps);
    const url    = new URL(result.authUrl);

    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://tixly.cz/api/identity/bankid/callback',
    );
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('state')).toBe(result.state);
    expect(url.searchParams.get('acr_values')).toBe('loa2');
    expect(url.searchParams.get('scope')).toContain('openid');
  });

  it('stores state in Redis with 600s TTL', async () => {
    const deps   = buildMockDeps();
    const result = await initiateVerification('user-uuid-1', '/dashboard', deps);

    expect(deps.redis.setex).toHaveBeenCalledWith(
      `bankid:state:${result.state}`,
      600,
      expect.any(String),
    );

    // Verify stored payload structure
    const storedJson = (deps.redis.setex as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
    const stored     = JSON.parse(storedJson);
    expect(stored.userId).toBe('user-uuid-1');
    expect(stored.redirectAfter).toBe('/dashboard');
    expect(stored.codeVerifier).toBeTruthy();
  });

  it('stores encrypted code_verifier in DB (not plaintext)', async () => {
    const deps   = buildMockDeps();
    const result = await initiateVerification('user-uuid-1', '/dashboard', deps);

    const redisPayload = JSON.parse(
      (deps.redis.setex as ReturnType<typeof vi.fn>).mock.calls[0][2] as string,
    );
    const plainVerifier = redisPayload.codeVerifier as string;

    // Find the DB execute call for bankid_auth_sessions
    const executeCalls = (deps.db.execute as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const sessionCall  = executeCalls.find((args) =>
      (args[0] as string).includes('bankid_auth_sessions'),
    );
    expect(sessionCall).toBeDefined();

    const params = sessionCall![1] as string[];
    const storedVerifier = params[2]; // third param = code_verifier

    // Must NOT store plaintext verifier
    expect(storedVerifier).not.toBe(plainVerifier);
    // Must be decryptable to the original
    expect(decryptPii(storedVerifier)).toBe(plainVerifier);

    // State in DB must equal the returned state
    expect(params[0]).toBe(result.state);
  });

  it('logs attempt with outcome=initiated', async () => {
    const deps = buildMockDeps();
    await initiateVerification('user-uuid-1', '/dashboard', deps);

    const executeCalls = (deps.db.execute as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const attemptCall  = executeCalls.find((args) =>
      (args[0] as string).includes('verification_attempts'),
    );
    expect(attemptCall).toBeDefined();
    const params = attemptCall![1] as string[];
    expect(params[1]).toBe('initiated');
  });
});

// ---------------------------------------------------------------------------
// handleCallback
// ---------------------------------------------------------------------------

describe('handleCallback', () => {
  function buildTokenFetch(
    userinfoOverrides: Record<string, unknown> = {},
    idTokenPayload: Record<string, unknown> = { iss: 'https://oidc.bankid.cz', acr: 'loa2' },
  ): typeof globalThis.fetch {
    return vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes('/oauth2/token')) {
        return Promise.resolve({
          ok:   true,
          json: () =>
            Promise.resolve({
              access_token: 'mock-access-token',
              id_token:     buildFakeIdToken(idTokenPayload),
              token_type:   'Bearer',
            }),
        });
      }
      if ((url as string).includes('/userinfo')) {
        return Promise.resolve({
          ok:   true,
          json: () => Promise.resolve(buildUserinfo(userinfoOverrides)),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url as string}`));
    }) as unknown as typeof globalThis.fetch;
  }

  function buildDepsWithState(
    state: string,
    session: { userId: string; codeVerifier: string; redirectAfter: string },
    userinfoOverrides: Record<string, unknown> = {},
  ): IdentityDeps {
    const deps = buildMockDeps({
      fetch: buildTokenFetch(userinfoOverrides),
    });

    (deps.redis.get as ReturnType<typeof vi.fn>).mockImplementation((key: string) => {
      if (key === `bankid:state:${state}`) {
        return Promise.resolve(JSON.stringify(session));
      }
      return Promise.resolve(null);
    });

    // Default: no existing verified_person (new person)
    (deps.db.query as ReturnType<typeof vi.fn>).mockImplementation((sql: string) => {
      if ((sql as string).includes('verified_persons') && (sql as string).includes('bank_id_sub')) {
        return Promise.resolve([]);  // no existing record
      }
      if ((sql as string).includes('INSERT INTO identity.verified_persons')) {
        return Promise.resolve([{ id: 'new-person-uuid' }]);
      }
      return Promise.resolve([]);
    });

    return deps;
  }

  it('successful flow: stores encrypted PII and returns redirectAfter', async () => {
    const state   = 'valid-state-token';
    const session = { userId: 'user-1', codeVerifier: 'verifier-abc', redirectAfter: '/dashboard' };
    const deps    = buildDepsWithState(state, session);

    // Mock INSERT returning new id
    (deps.db.query as ReturnType<typeof vi.fn>).mockImplementation((sql: string) => {
      if ((sql as string).includes('verified_persons') && (sql as string).includes('WHERE bank_id_sub')) {
        return Promise.resolve([]);
      }
      if ((sql as string).includes('INSERT INTO identity.verified_persons')) {
        return Promise.resolve([{ id: 'new-person-uuid' }]);
      }
      return Promise.resolve([]);
    });

    const result = await handleCallback(state, state, '1.2.3.4', deps);

    expect(result.redirectAfter).toBe('/dashboard');
    expect(result.alreadyVerified).toBe(false);

    // Verify Redis state was deleted
    expect(deps.redis.del).toHaveBeenCalledWith(`bankid:state:${state}`);

    // Verify PII was encrypted in the INSERT call
    const queryCalls = (deps.db.query as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const insertCall = queryCalls.find((args) =>
      (args[0] as string).includes('INSERT INTO identity.verified_persons'),
    );
    expect(insertCall).toBeDefined();
    const insertParams = insertCall![1] as string[];
    // params: [sub, iss, acr, first_name_enc, last_name_enc, birthdate_enc, idcard_expiry_enc]
    const firstNameEnc = insertParams[3];
    const lastNameEnc  = insertParams[4];
    const birthdateEnc = insertParams[5];

    expect(decryptPii(firstNameEnc)).toBe('Jan');
    expect(decryptPii(lastNameEnc)).toBe('Novák');
    expect(decryptPii(birthdateEnc)).toBe('1990-06-15');
  });

  it('unknown state (never existed) → throws STATE_EXPIRED', async () => {
    const deps = buildMockDeps();
    // redis.get returns null for unknown state
    (deps.redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(
      handleCallback('unknown-state', 'unknown-state', '1.2.3.4', deps),
    ).rejects.toThrow(expect.objectContaining({ code: IdentityErrorCode.STATE_EXPIRED }));
  });

  it('expired state (Redis TTL elapsed, returns null) → throws STATE_EXPIRED', async () => {
    const deps = buildMockDeps();
    (deps.redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(
      handleCallback('expired-state', 'expired-state', '1.2.3.4', deps),
    ).rejects.toThrow(IdentityError);
  });

  it('token exchange HTTP failure → throws TOKEN_EXCHANGE_FAILED', async () => {
    const state   = 'good-state';
    const session = { userId: 'user-2', codeVerifier: 'verifier', redirectAfter: '/dashboard' };
    const deps    = buildMockDeps({
      fetch: vi.fn().mockResolvedValue({
        ok:     false,
        status: 400,
        json:   () => Promise.resolve({ error: 'invalid_grant' }),
      }) as unknown as typeof globalThis.fetch,
    });

    (deps.redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(session));

    await expect(
      handleCallback(state, state, '1.2.3.4', deps),
    ).rejects.toThrow(expect.objectContaining({ code: IdentityErrorCode.TOKEN_EXCHANGE_FAILED }));
  });

  it('userinfo HTTP failure → throws USERINFO_FAILED', async () => {
    const state   = 'good-state';
    const session = { userId: 'user-3', codeVerifier: 'verifier', redirectAfter: '/dashboard' };

    let callCount = 0;
    const deps = buildMockDeps({
      fetch: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // token exchange succeeds
          return Promise.resolve({
            ok:   true,
            json: () =>
              Promise.resolve({
                access_token: 'token',
                id_token:     buildFakeIdToken({ acr: 'loa2' }),
                token_type:   'Bearer',
              }),
          });
        }
        // userinfo fails
        return Promise.resolve({ ok: false, status: 401 });
      }) as unknown as typeof globalThis.fetch,
    });

    (deps.redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(session));

    await expect(
      handleCallback(state, state, '1.2.3.4', deps),
    ).rejects.toThrow(expect.objectContaining({ code: IdentityErrorCode.USERINFO_FAILED }));
  });

  it('duplicate bank_id_sub → links to existing verified_person, alreadyVerified=true', async () => {
    const state   = 'dup-state';
    const session = { userId: 'user-4', codeVerifier: 'verifier', redirectAfter: '/events' };
    const existingPersonId = 'existing-person-uuid';

    const deps = buildMockDeps({
      fetch: vi.fn().mockImplementation((url: string) => {
        if ((url as string).includes('/oauth2/token')) {
          return Promise.resolve({
            ok:   true,
            json: () =>
              Promise.resolve({
                access_token: 'token',
                id_token:     buildFakeIdToken({ acr: 'loa2' }),
                token_type:   'Bearer',
              }),
          });
        }
        if ((url as string).includes('/userinfo')) {
          return Promise.resolve({
            ok:   true,
            json: () => Promise.resolve(buildUserinfo()),
          });
        }
      }) as unknown as typeof globalThis.fetch,
    });

    (deps.redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(session));

    // Existing verified_person for this bank_id_sub
    (deps.db.query as ReturnType<typeof vi.fn>).mockImplementation((sql: string) => {
      if ((sql as string).includes('WHERE bank_id_sub')) {
        return Promise.resolve([{ id: existingPersonId }]);
      }
      return Promise.resolve([]);
    });

    const result = await handleCallback(state, state, '5.6.7.8', deps);

    expect(result.alreadyVerified).toBe(true);
    expect(result.redirectAfter).toBe('/events');

    // UPDATE should have been called (not INSERT) for verified_persons
    const executeCalls = (deps.db.execute as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const updateCall   = executeCalls.find((args) =>
      (args[0] as string).includes('UPDATE identity.verified_persons'),
    );
    expect(updateCall).toBeDefined();

    // user_verifications upsert should reference the existing person
    const upsertCall = executeCalls.find((args) =>
      (args[0] as string).includes('INSERT INTO identity.user_verifications'),
    );
    expect(upsertCall).toBeDefined();
    const upsertParams = upsertCall![1] as string[];
    expect(upsertParams[1]).toBe(existingPersonId);
  });

  it('logs success outcome after successful callback', async () => {
    const state   = 'success-state';
    const session = { userId: 'user-5', codeVerifier: 'verifier', redirectAfter: '/dashboard' };

    const deps = buildMockDeps({
      fetch: vi.fn().mockImplementation((url: string) => {
        if ((url as string).includes('/oauth2/token')) {
          return Promise.resolve({
            ok:   true,
            json: () =>
              Promise.resolve({
                access_token: 'token',
                id_token:     buildFakeIdToken({ acr: 'loa2' }),
                token_type:   'Bearer',
              }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(buildUserinfo()) });
      }) as unknown as typeof globalThis.fetch,
    });

    (deps.redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(session));
    (deps.db.query as ReturnType<typeof vi.fn>).mockImplementation((sql: string) => {
      if ((sql as string).includes('WHERE bank_id_sub')) return Promise.resolve([]);
      if ((sql as string).includes('INSERT INTO identity.verified_persons')) {
        return Promise.resolve([{ id: 'new-uuid' }]);
      }
      return Promise.resolve([]);
    });

    await handleCallback(state, state, '9.9.9.9', deps);

    const executeCalls = (deps.db.execute as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const attemptCalls = executeCalls.filter((args) =>
      (args[0] as string).includes('verification_attempts'),
    );
    const outcomes = attemptCalls.map((args) => (args[1] as string[])[1]);
    expect(outcomes).toContain('success');
  });
});

// ---------------------------------------------------------------------------
// getVerificationStatus
// ---------------------------------------------------------------------------

describe('getVerificationStatus', () => {
  it('returns isVerified=false for unverified user (no rows)', async () => {
    const deps = buildMockDeps();
    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const status = await getVerificationStatus('unknown-user', deps);

    expect(status.isVerified).toBe(false);
    expect(status.verifiedAt).toBeNull();
    expect(status.acr).toBeNull();
    expect(status.needsReverification).toBe(false);
  });

  it('returns isVerified=true for verified user', async () => {
    const deps = buildMockDeps();
    const futureExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        linked_at:         '2026-01-01T00:00:00Z',
        unlinked_at:       null,
        verified_at:       '2026-01-01T00:00:00Z',
        expires_at:        null,
        acr:               'loa2',
        idcard_expiry_enc: encryptPii(futureExpiry),
        is_active:         true,
      },
    ]);

    const status = await getVerificationStatus('user-ok', deps);

    expect(status.isVerified).toBe(true);
    expect(status.verifiedAt).toBe('2026-01-01T00:00:00Z');
    expect(status.acr).toBe('loa2');
    expect(status.needsReverification).toBe(false);
  });

  it('needsReverification=true when idcard has expired', async () => {
    const deps = buildMockDeps();
    const pastExpiry = '2020-12-31';  // clearly in the past

    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        linked_at:         '2021-01-01T00:00:00Z',
        unlinked_at:       null,
        verified_at:       '2021-01-01T00:00:00Z',
        expires_at:        null,
        acr:               'loa2',
        idcard_expiry_enc: encryptPii(pastExpiry),
        is_active:         true,
      },
    ]);

    const status = await getVerificationStatus('user-expired', deps);

    expect(status.isVerified).toBe(true);
    expect(status.needsReverification).toBe(true);
  });

  it('returns isVerified=false when user is unlinked (soft GDPR erase)', async () => {
    const deps = buildMockDeps();

    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        linked_at:         '2026-01-01T00:00:00Z',
        unlinked_at:       '2026-03-01T00:00:00Z',  // unlinked
        verified_at:       '2026-01-01T00:00:00Z',
        expires_at:        null,
        acr:               'loa2',
        idcard_expiry_enc: null,
        is_active:         true,
      },
    ]);

    const status = await getVerificationStatus('user-unlinked', deps);
    expect(status.isVerified).toBe(false);
  });

  it('returns isVerified=false when is_active=false', async () => {
    const deps = buildMockDeps();

    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        linked_at:         '2026-01-01T00:00:00Z',
        unlinked_at:       null,
        verified_at:       '2026-01-01T00:00:00Z',
        expires_at:        null,
        acr:               'loa2',
        idcard_expiry_enc: null,
        is_active:         false,
      },
    ]);

    const status = await getVerificationStatus('user-inactive', deps);
    expect(status.isVerified).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Timing-safe state comparison — smoke test
// ---------------------------------------------------------------------------

describe('timing-safe state validation', () => {
  it('rejects when state does not match stored session', async () => {
    const deps = buildMockDeps();

    // Store a session for stateA but submit stateB
    (deps.redis.get as ReturnType<typeof vi.fn>).mockImplementation((key: string) => {
      if (key === 'bankid:state:stateA') {
        return Promise.resolve(
          JSON.stringify({ userId: 'u1', codeVerifier: 'cv', redirectAfter: '/x' }),
        );
      }
      return Promise.resolve(null);
    });

    // Submitting stateB — Redis lookup returns null → STATE_EXPIRED
    await expect(
      handleCallback('code', 'stateB', '1.1.1.1', deps),
    ).rejects.toThrow(IdentityError);
  });
});
