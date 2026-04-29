import { describe, it, expect, vi } from 'vitest';
import {
  generateRegistrationChallenge,
  registerCredential,
  generateAuthenticationChallenge,
  verifyAuthentication,
  listUserPasskeys,
  deletePasskey,
  renamePasskey,
} from '../services/passkey.service.js';
import type { DbAdapter } from '../services/passkey.service.js';

function makeChallengeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'challenge-001',
    user_id: 'user-001',
    challenge: 'base64urlchallengevalue',
    type: 'registration',
    expires_at: new Date(Date.now() + 300000).toISOString(),
    ...overrides,
  };
}

function makeCredentialRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cred-001',
    user_id: 'user-001',
    credential_id: 'credIdBase64url',
    public_key_cose: 'pubKeyBase64url',
    sign_count: 0,
    device_type: 'platform',
    aaguid: null,
    friendly_name: 'iPhone 15',
    backed_up: true,
    transports: ['internal'],
    last_used_at: null,
    created_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeDb(queryResults: unknown[][] = [], executeMock = vi.fn()): DbAdapter {
  let callIdx = 0;
  return {
    query: vi.fn(async () => {
      const result = queryResults[callIdx] ?? [];
      callIdx++;
      return result;
    }),
    execute: executeMock,
  };
}

describe('generateRegistrationChallenge', () => {
  it('vygeneruje registrační výzvu s náhodným nonce', async () => {
    const db = makeDb([[makeChallengeRow({ type: 'registration' })]]);
    const result = await generateRegistrationChallenge('user-001', db);
    expect(result.type).toBe('registration');
    expect(result.challenge).toBeTruthy();
  });

  it('funguje i bez userId (pro nové uživatele)', async () => {
    const db = makeDb([[makeChallengeRow({ user_id: null })]]);
    const result = await generateRegistrationChallenge(null, db);
    expect(result.userId).toBeNull();
  });
});

describe('registerCredential', () => {
  it('zaregistruje nový passkey po úspěšné WebAuthn ceremony', async () => {
    const challengeRow = makeChallengeRow({ type: 'registration', user_id: 'user-001' });
    const credRow = makeCredentialRow();
    const db = makeDb([[challengeRow], [credRow]]);

    const result = await registerCredential({
      userId: 'user-001',
      challengeId: 'challenge-001',
      credentialId: 'credIdBase64url',
      publicKeyCose: 'pubKeyBase64url',
      deviceType: 'platform',
      friendlyName: 'iPhone 15',
      backedUp: true,
      transports: ['internal'],
    }, db);

    expect(result.credentialId).toBe('credIdBase64url');
    expect(result.deviceType).toBe('platform');
    expect(result.friendlyName).toBe('iPhone 15');
  });

  it('odmítne expirovanou nebo neexistující výzvu', async () => {
    const db = makeDb([[]]); // empty = challenge not found/expired
    await expect(registerCredential({
      userId: 'user-001', challengeId: 'bad-id',
      credentialId: 'cred', publicKeyCose: 'key',
    }, db)).rejects.toThrow('CHALLENGE_INVALID_OR_EXPIRED');
  });

  it('odmítne výzvu pro jiného uživatele', async () => {
    const challengeRow = makeChallengeRow({ user_id: 'user-999' });
    const db = makeDb([[challengeRow]]);
    await expect(registerCredential({
      userId: 'user-001', challengeId: 'challenge-001',
      credentialId: 'cred', publicKeyCose: 'key',
    }, db)).rejects.toThrow('CHALLENGE_USER_MISMATCH');
  });
});

describe('generateAuthenticationChallenge', () => {
  it('vygeneruje autentizační výzvu', async () => {
    const db = makeDb([[makeChallengeRow({ type: 'authentication' })]]);
    const result = await generateAuthenticationChallenge('user-001', db);
    expect(result.type).toBe('authentication');
  });
});

describe('verifyAuthentication', () => {
  it('ověří autentizaci a aktualizuje sign_count', async () => {
    const challengeRow = makeChallengeRow({ type: 'authentication' });
    const credRow = makeCredentialRow({ sign_count: 5 });
    const updatedCred = makeCredentialRow({ sign_count: 6, last_used_at: '2026-04-14T14:00:00Z' });
    const db = makeDb([[challengeRow], [credRow], [updatedCred]]);

    const result = await verifyAuthentication({
      challengeId: 'challenge-001',
      credentialId: 'credIdBase64url',
      newSignCount: 6,
    }, db);

    expect(result.userId).toBe('user-001');
    expect(result.credential.signCount).toBe(6);
  });

  it('odmítne expirovanou výzvu', async () => {
    const db = makeDb([[]]); // empty = expired
    await expect(verifyAuthentication({
      challengeId: 'bad', credentialId: 'cred', newSignCount: 1,
    }, db)).rejects.toThrow('CHALLENGE_INVALID_OR_EXPIRED');
  });

  it('odmítne neexistující credential', async () => {
    const db = makeDb([[makeChallengeRow({ type: 'authentication' })], []]);
    await expect(verifyAuthentication({
      challengeId: 'challenge-001', credentialId: 'unknown', newSignCount: 1,
    }, db)).rejects.toThrow('CREDENTIAL_NOT_FOUND');
  });

  it('odmítne podezřelý sign_count (ochrana proti klonovanému authenticatoru)', async () => {
    const challengeRow = makeChallengeRow({ type: 'authentication' });
    const credRow = makeCredentialRow({ sign_count: 10 });
    const db = makeDb([[challengeRow], [credRow]]);

    await expect(verifyAuthentication({
      challengeId: 'challenge-001', credentialId: 'credIdBase64url', newSignCount: 9,
    }, db)).rejects.toThrow('SIGN_COUNT_INVALID');
  });

  it('povolí sign_count = 0 (authenticator nesleduje počítadlo)', async () => {
    const challengeRow = makeChallengeRow({ type: 'authentication' });
    const credRow = makeCredentialRow({ sign_count: 0 });
    const updatedCred = makeCredentialRow({ sign_count: 0 });
    const db = makeDb([[challengeRow], [credRow], [updatedCred]]);

    const result = await verifyAuthentication({
      challengeId: 'challenge-001', credentialId: 'credIdBase64url', newSignCount: 0,
    }, db);
    expect(result.credential.signCount).toBe(0);
  });
});

describe('listUserPasskeys', () => {
  it('vrátí seznam passkeys uživatele', async () => {
    const db = makeDb([[
      makeCredentialRow({ friendly_name: 'iPhone' }),
      makeCredentialRow({ id: 'cred-002', credential_id: 'cred2', friendly_name: 'YubiKey', device_type: 'cross-platform' }),
    ]]);
    const result = await listUserPasskeys('user-001', db);
    expect(result).toHaveLength(2);
    expect(result[1].deviceType).toBe('cross-platform');
  });
});

describe('deletePasskey', () => {
  it('smaže passkey uživatele', async () => {
    const db = makeDb([[{ id: 'cred-001' }]]);
    await expect(deletePasskey('cred-001', 'user-001', db)).resolves.toBeUndefined();
  });

  it('vyhodí chybu pro neexistující credential', async () => {
    const db = makeDb([[]]); // empty
    await expect(deletePasskey('bad-id', 'user-001', db)).rejects.toThrow('CREDENTIAL_NOT_FOUND');
  });
});

describe('renamePasskey', () => {
  it('přejmenuje passkey', async () => {
    const updatedRow = makeCredentialRow({ friendly_name: 'Můj MacBook' });
    const db = makeDb([[updatedRow]]);
    const result = await renamePasskey('cred-001', 'user-001', 'Můj MacBook', db);
    expect(result.friendlyName).toBe('Můj MacBook');
  });

  it('odmítne prázdný název', async () => {
    const db = makeDb();
    await expect(renamePasskey('cred-001', 'user-001', '   ', db))
      .rejects.toThrow('friendlyName is required');
  });
});
