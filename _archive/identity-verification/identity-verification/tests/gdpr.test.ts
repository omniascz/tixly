import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportUserData, eraseUserData } from '../src/services/gdpr.service';

// Mock identity-crypto so getDecryptedIdentity doesn't need real keys
vi.mock('../src/lib/identity-crypto.js', () => ({
  encryptPii: (v: string) => `enc:${v}`,
  decryptPii: (v: string) => v.replace('enc:', ''),
  hashIdentity: (v: string) => 'hash_' + v,
}));

function makeDeps() {
  return {
    db: {
      query: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    },
    redis: {
      setex: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      del: vi.fn().mockResolvedValue(undefined),
    },
  };
}

const USER_ID = 'u1u1u1u1-0000-0000-0000-000000000001';

describe('exportUserData', () => {
  it('returns empty data when user has no identity', async () => {
    const deps = makeDeps();
    // getDecryptedIdentity queries → empty
    deps.db.query = vi.fn().mockResolvedValue([]);

    const result = await exportUserData(USER_ID, deps);
    expect(result.userId).toBe(USER_ID);
    expect(result.identity).toBeNull();
    expect(result.verificationAttempts).toEqual([]);
    expect(result.onfidoVerifications).toEqual([]);
    expect(result.purchaseRecords).toEqual([]);
  });

  it('returns decrypted identity when user is verified', async () => {
    const deps = makeDeps();
    let callNum = 0;
    deps.db.query = vi.fn().mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        // getDecryptedIdentity → verified person joined
        return Promise.resolve([{
          first_name_enc: 'enc:Jan',
          last_name_enc: 'enc:Novák',
          birthdate_enc: 'enc:1990-01-15',
          idcard_expiry_enc: 'enc:2030-12-31',
          unlinked_at: null,
          is_active: true,
        }]);
      }
      if (callNum === 2) {
        // verification_attempts
        return Promise.resolve([
          { provider: 'bankid', outcome: 'success', created_at: '2026-03-01T10:00:00Z' },
        ]);
      }
      return Promise.resolve([]);
    });

    const result = await exportUserData(USER_ID, deps);
    expect(result.identity).toEqual({
      firstName: 'Jan',
      lastName: 'Novák',
      birthdate: '1990-01-15',
      idcardExpiry: '2030-12-31',
    });
    expect(result.verificationAttempts).toHaveLength(1);
    expect(result.verificationAttempts[0].outcome).toBe('success');
  });
});

describe('eraseUserData', () => {
  it('unlinks verification and cleans up sessions', async () => {
    const deps = makeDeps();
    let callNum = 0;
    deps.db.query = vi.fn().mockImplementation(() => {
      callNum++;
      if (callNum === 1) return Promise.resolve([{ id: 'uv_1' }]); // unlink
      if (callNum === 2) return Promise.resolve([{ state: 'state_1' }, { state: 'state_2' }]); // sessions
      return Promise.resolve([]); // identity lookup → no purchases
    });

    const result = await eraseUserData(USER_ID, deps);
    expect(result.unlinked).toBe(true);
    expect(result.sessionsDeleted).toBe(2);
    expect(result.purchasesDeleted).toBe(0);
    expect(deps.redis.del).toHaveBeenCalled();
  });

  it('returns unlinked=false when no active verification exists', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn().mockResolvedValue([]);

    const result = await eraseUserData(USER_ID, deps);
    expect(result.unlinked).toBe(false);
    expect(result.sessionsDeleted).toBe(0);
  });

  it('deletes purchase records when identity hash found', async () => {
    const deps = makeDeps();
    let callNum = 0;
    deps.db.query = vi.fn().mockImplementation(() => {
      callNum++;
      if (callNum === 1) return Promise.resolve([{ id: 'uv_1' }]); // unlink
      if (callNum === 2) return Promise.resolve([]); // sessions
      if (callNum === 3) return Promise.resolve([{ identity_hash: 'abc123' }]); // identity lookup
      if (callNum === 4) return Promise.resolve([{ id: '1' }, { id: '2' }, { id: '3' }]); // delete purchases
      return Promise.resolve([]);
    });

    const result = await eraseUserData(USER_ID, deps);
    expect(result.purchasesDeleted).toBe(3);
  });
});
