import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import type { MockedFunction } from 'vitest';

// Mock bcryptjs before importing auth.service
vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(),
  },
}));

import bcrypt from 'bcryptjs';
import {
  login,
  refresh,
  logout,
  logoutAll,
  cleanupExpiredTokens,
} from '../services/auth.service';
import { AuthError } from '../lib/auth-errors';
import type { DbAdapter, ServiceDeps } from '../lib/service-container';
import type { RefreshTokenRecord, UserRecord } from '../types/auth';
import { verifyAccessToken, verifyRefreshToken } from '../services/jwt.service';

const VALID_SECRET = 'super-secret-key-that-is-at-least-32-chars!!';

const bcryptCompare = bcrypt.compare as MockedFunction<typeof bcrypt.compare>;

// ── Helpers ───────────────────────────────────────────────────────────────

function makeUser(overrides?: Partial<UserRecord>): UserRecord {
  return {
    id: randomUUID(),
    email: 'user@example.com',
    name: 'Test User',
    password_hash: '$2b$12$hashedpassword',
    is_admin: false,
    ...overrides,
  };
}

function makeMockDb(): DbAdapter & {
  _queryImpl: (sql: string, params?: unknown[]) => unknown[];
  _executeImpl: (sql: string, params?: unknown[]) => void;
} {
  const queryMock = vi.fn();
  const executeMock = vi.fn();

  return {
    query: queryMock,
    execute: executeMock,
    _queryImpl: queryMock,
    _executeImpl: executeMock,
  };
}

function makeDeps(db: DbAdapter): ServiceDeps {
  return { db };
}

describe('AuthService', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = VALID_SECRET;
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
  });

  // ── login ─────────────────────────────────────────────────────────────────

  describe('login()', () => {
    it('valid credentials → returns accessToken + refreshToken', async () => {
      const user = makeUser();
      const db = makeMockDb();
      db.query = vi.fn().mockResolvedValueOnce([user]);
      db.execute = vi.fn().mockResolvedValue(undefined);
      bcryptCompare.mockResolvedValueOnce(true as never);

      const result = await login(user.email, 'correct-password', makeDeps(db));

      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
      expect(result.expiresIn).toBe(900);

      // Verify access token contains correct userId
      const payload = await verifyAccessToken(result.accessToken);
      expect(payload.sub).toBe(user.id);
      expect(payload.email).toBe(user.email);
    });

    it('wrong password → throws USER_NOT_FOUND (INVALID_CREDENTIALS behavior)', async () => {
      const user = makeUser();
      const db = makeMockDb();
      db.query = vi.fn().mockResolvedValueOnce([user]);
      db.execute = vi.fn().mockResolvedValue(undefined);
      bcryptCompare.mockResolvedValueOnce(false as never);

      await expect(login(user.email, 'wrong-password', makeDeps(db))).rejects.toMatchObject({
        code: 'USER_NOT_FOUND',
      });
    });

    it('non-existent email → throws USER_NOT_FOUND (timing-safe, same error as wrong password)', async () => {
      const db = makeMockDb();
      db.query = vi.fn().mockResolvedValueOnce([]); // no user found
      db.execute = vi.fn().mockResolvedValue(undefined);
      // bcrypt is still called with a dummy hash for constant timing
      bcryptCompare.mockResolvedValueOnce(false as never);

      await expect(login('nouser@example.com', 'any-password', makeDeps(db))).rejects.toMatchObject({
        code: 'USER_NOT_FOUND',
      });

      // bcrypt.compare must have been called (timing-safe behavior)
      expect(bcryptCompare).toHaveBeenCalledOnce();
    });

    it('stores refresh token in DB on successful login', async () => {
      const user = makeUser();
      const db = makeMockDb();
      db.query = vi.fn().mockResolvedValueOnce([user]);
      db.execute = vi.fn().mockResolvedValue(undefined);
      bcryptCompare.mockResolvedValueOnce(true as never);

      await login(user.email, 'password', makeDeps(db));

      expect(db.execute).toHaveBeenCalledOnce();
      const [sql, params] = (db.execute as MockedFunction<DbAdapter['execute']>).mock.calls[0];
      expect(sql).toContain('INSERT INTO identity.refresh_tokens');
      expect(params).toHaveLength(4); // jti, user_id, family, expires_at
      expect(params![1]).toBe(user.id);
    });
  });

  // ── refresh ───────────────────────────────────────────────────────────────

  describe('refresh()', () => {
    async function setupRefreshToken(userId: string) {
      const { signRefreshToken } = await import('../services/jwt.service');
      const family = randomUUID();
      const { token, jti } = await signRefreshToken(userId, family);
      return { token, jti, family };
    }

    it('valid token → returns new accessToken + refreshToken', async () => {
      const user = makeUser();
      const { token, jti, family } = await setupRefreshToken(user.id);

      const record: RefreshTokenRecord = {
        jti,
        user_id: user.id,
        family,
        is_revoked: false,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      };

      const db = makeMockDb();
      db.query = vi.fn()
        .mockResolvedValueOnce([record])   // fetch refresh token record
        .mockResolvedValueOnce([user]);    // fetch user for new access token
      db.execute = vi.fn().mockResolvedValue(undefined);

      const result = await refresh(token, makeDeps(db));

      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
      expect(result.refreshToken).not.toBe(token); // must be a new token
      expect(result.expiresIn).toBe(900);
    });

    it('revoked token in active family → revokes entire family + throws REFRESH_TOKEN_REUSE', async () => {
      const user = makeUser();
      const { token, jti, family } = await setupRefreshToken(user.id);

      const record: RefreshTokenRecord = {
        jti,
        user_id: user.id,
        family,
        is_revoked: true, // already revoked!
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      };

      const db = makeMockDb();
      db.query = vi.fn().mockResolvedValueOnce([record]);
      db.execute = vi.fn().mockResolvedValue(undefined);

      await expect(refresh(token, makeDeps(db))).rejects.toMatchObject({
        code: 'REFRESH_TOKEN_REUSE',
      });

      // Verify entire family was revoked
      const executeCalls = (db.execute as MockedFunction<DbAdapter['execute']>).mock.calls;
      expect(executeCalls.some(([sql]) => sql.includes('family'))).toBe(true);
    });

    it('token not in DB → throws TOKEN_REVOKED', async () => {
      const user = makeUser();
      const { token } = await setupRefreshToken(user.id);

      const db = makeMockDb();
      db.query = vi.fn().mockResolvedValueOnce([]); // not found
      db.execute = vi.fn().mockResolvedValue(undefined);

      await expect(refresh(token, makeDeps(db))).rejects.toMatchObject({
        code: 'TOKEN_REVOKED',
      });
    });

    it('expired JWT → throws TOKEN_EXPIRED', async () => {
      const { SignJWT } = await import('jose');
      const secret = new TextEncoder().encode(VALID_SECRET);
      const now = Math.floor(Date.now() / 1000);
      const expiredToken = await new SignJWT({
        sub: randomUUID(),
        jti: randomUUID(),
        family: randomUUID(),
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt(now - 3600)
        .setExpirationTime(now - 1800)
        .sign(secret);

      const db = makeMockDb();
      db.query = vi.fn();
      db.execute = vi.fn();

      await expect(refresh(expiredToken, makeDeps(db))).rejects.toMatchObject({
        code: 'TOKEN_EXPIRED',
      });
    });

    it('token rotation: old jti is revoked after refresh', async () => {
      const user = makeUser();
      const { token, jti, family } = await setupRefreshToken(user.id);

      const record: RefreshTokenRecord = {
        jti,
        user_id: user.id,
        family,
        is_revoked: false,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      };

      const db = makeMockDb();
      db.query = vi.fn()
        .mockResolvedValueOnce([record])
        .mockResolvedValueOnce([user]);
      db.execute = vi.fn().mockResolvedValue(undefined);

      await refresh(token, makeDeps(db));

      const executeCalls = (db.execute as MockedFunction<DbAdapter['execute']>).mock.calls;
      // First execute call should revoke old jti
      const revokeCall = executeCalls.find(([sql, params]) =>
        sql.includes('is_revoked = TRUE') && Array.isArray(params) && params.includes(jti)
      );
      expect(revokeCall).toBeDefined();
    });

    it('new refresh token preserves same family', async () => {
      const user = makeUser();
      const { token, jti, family } = await setupRefreshToken(user.id);

      const record: RefreshTokenRecord = {
        jti,
        user_id: user.id,
        family,
        is_revoked: false,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      };

      const db = makeMockDb();
      db.query = vi.fn()
        .mockResolvedValueOnce([record])
        .mockResolvedValueOnce([user]);
      db.execute = vi.fn().mockResolvedValue(undefined);

      const result = await refresh(token, makeDeps(db));

      // New refresh token should have same family
      const newPayload = await verifyRefreshToken(result.refreshToken);
      expect(newPayload.family).toBe(family);
      // But different jti
      expect(newPayload.jti).not.toBe(jti);
    });
  });

  // ── logout ────────────────────────────────────────────────────────────────

  describe('logout()', () => {
    it('revokes the specific jti', async () => {
      const userId = randomUUID();
      const { signRefreshToken } = await import('../services/jwt.service');
      const { token, jti } = await signRefreshToken(userId, randomUUID());

      const db = makeMockDb();
      db.execute = vi.fn().mockResolvedValue(undefined);

      await logout(token, makeDeps(db));

      expect(db.execute).toHaveBeenCalledOnce();
      const [sql, params] = (db.execute as MockedFunction<DbAdapter['execute']>).mock.calls[0];
      expect(sql).toContain('is_revoked = TRUE');
      expect(params).toContain(jti);
    });

    it('silently ignores invalid tokens (best-effort)', async () => {
      const db = makeMockDb();
      db.execute = vi.fn().mockResolvedValue(undefined);

      await expect(logout('not.a.valid.token', makeDeps(db))).resolves.toBeUndefined();
      expect(db.execute).not.toHaveBeenCalled();
    });
  });

  // ── logoutAll ─────────────────────────────────────────────────────────────

  describe('logoutAll()', () => {
    it('revokes all refresh tokens for the given userId', async () => {
      const userId = randomUUID();
      const db = makeMockDb();
      db.execute = vi.fn().mockResolvedValue(undefined);

      await logoutAll(userId, makeDeps(db));

      expect(db.execute).toHaveBeenCalledOnce();
      const [sql, params] = (db.execute as MockedFunction<DbAdapter['execute']>).mock.calls[0];
      expect(sql).toContain('is_revoked = TRUE');
      expect(sql).toContain('user_id');
      expect(params).toContain(userId);
    });
  });

  // ── cleanupExpiredTokens ──────────────────────────────────────────────────

  describe('cleanupExpiredTokens()', () => {
    it('deletes revoked expired tokens and returns count', async () => {
      const db = makeMockDb();
      db.query = vi.fn().mockResolvedValueOnce([{ count: '7' }]);
      db.execute = vi.fn();

      const count = await cleanupExpiredTokens(makeDeps(db));

      expect(count).toBe(7);
      const [sql] = (db.query as MockedFunction<DbAdapter['query']>).mock.calls[0];
      expect(sql).toContain('expires_at < NOW()');
      expect(sql).toContain('is_revoked = TRUE');
    });

    it('returns 0 when nothing to clean up', async () => {
      const db = makeMockDb();
      db.query = vi.fn().mockResolvedValueOnce([{ count: '0' }]);
      db.execute = vi.fn();

      const count = await cleanupExpiredTokens(makeDeps(db));
      expect(count).toBe(0);
    });
  });
});
