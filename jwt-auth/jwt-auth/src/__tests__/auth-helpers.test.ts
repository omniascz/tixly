import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { SignJWT } from 'jose';
import {
  extractAndVerifyToken,
  requireUser,
  requireAdmin,
  requirePromoterMember,
  extractTokenOptional,
} from '../lib/auth-helpers';
import { AuthError } from '../lib/auth-errors';
import type { DbAdapter, ServiceDeps } from '../lib/service-container';
import type { MemberRole } from '../types/auth';

const VALID_SECRET = 'super-secret-key-that-is-at-least-32-chars!!';

// ── Helpers ───────────────────────────────────────────────────────────────

async function makeAccessToken(overrides?: {
  sub?: string;
  email?: string;
  name?: string;
  isAdmin?: boolean;
  expiredAgo?: number; // seconds
}): Promise<string> {
  const secret = new TextEncoder().encode(VALID_SECRET);
  const now = Math.floor(Date.now() / 1000);
  const exp = overrides?.expiredAgo
    ? now - overrides.expiredAgo
    : now + 900;

  return new SignJWT({
    sub: overrides?.sub ?? randomUUID(),
    email: overrides?.email ?? 'user@example.com',
    name: overrides?.name ?? 'Test User',
    isAdmin: overrides?.isAdmin ?? false,
    jti: randomUUID(),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(secret);
}

function makeRequest(authHeader?: string): Request {
  const headers: HeadersInit = {};
  if (authHeader !== undefined) {
    headers['Authorization'] = authHeader;
  }
  return new Request('http://localhost/api/test', { headers });
}

function makeMockDb(rows: unknown[] = []): DbAdapter {
  return {
    query: vi.fn().mockResolvedValue(rows),
    execute: vi.fn().mockResolvedValue(undefined),
  };
}

function makeDeps(db: DbAdapter): ServiceDeps {
  return { db };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('auth-helpers', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = VALID_SECRET;
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
    vi.restoreAllMocks();
  });

  // ── requireUser ───────────────────────────────────────────────────────────

  describe('requireUser()', () => {
    it('valid Bearer token → returns userId, email, isAdmin', async () => {
      const userId = randomUUID();
      const token = await makeAccessToken({ sub: userId, isAdmin: false });
      const request = makeRequest(`Bearer ${token}`);

      const result = await requireUser(request);

      expect(result.userId).toBe(userId);
      expect(result.email).toBe('user@example.com');
      expect(result.isAdmin).toBe(false);
    });

    it('missing Authorization header → throws TOKEN_MISSING', async () => {
      const request = makeRequest();

      await expect(requireUser(request)).rejects.toMatchObject({
        code: 'TOKEN_MISSING',
      });
    });

    it('Authorization header without Bearer prefix → throws TOKEN_MISSING', async () => {
      const token = await makeAccessToken();
      const request = makeRequest(`Basic ${token}`);

      await expect(requireUser(request)).rejects.toMatchObject({
        code: 'TOKEN_MISSING',
      });
    });

    it('invalid token string → throws TOKEN_INVALID', async () => {
      const request = makeRequest('Bearer this.is.notvalid');

      await expect(requireUser(request)).rejects.toMatchObject({
        code: 'TOKEN_INVALID',
      });
    });

    it('expired token → throws TOKEN_EXPIRED', async () => {
      const token = await makeAccessToken({ expiredAgo: 3600 });
      const request = makeRequest(`Bearer ${token}`);

      await expect(requireUser(request)).rejects.toMatchObject({
        code: 'TOKEN_EXPIRED',
      });
    });
  });

  // ── requireAdmin ──────────────────────────────────────────────────────────

  describe('requireAdmin()', () => {
    it('isAdmin=true → returns userId', async () => {
      const userId = randomUUID();
      const token = await makeAccessToken({ sub: userId, isAdmin: true });
      const request = makeRequest(`Bearer ${token}`);

      const result = await requireAdmin(request);
      expect(result.userId).toBe(userId);
    });

    it('isAdmin=false → throws ADMIN_REQUIRED (403)', async () => {
      const token = await makeAccessToken({ isAdmin: false });
      const request = makeRequest(`Bearer ${token}`);

      await expect(requireAdmin(request)).rejects.toMatchObject({
        code: 'ADMIN_REQUIRED',
        status: 403,
      });
    });

    it('missing token → throws TOKEN_MISSING before admin check', async () => {
      const request = makeRequest();

      await expect(requireAdmin(request)).rejects.toMatchObject({
        code: 'TOKEN_MISSING',
      });
    });
  });

  // ── requirePromoterMember ─────────────────────────────────────────────────

  describe('requirePromoterMember()', () => {
    const promoterId = randomUUID();

    function makeMemberRow(role: MemberRole = 'owner', status = 'active') {
      return {
        user_id: randomUUID(),
        promoter_id: promoterId,
        role,
        status,
      };
    }

    it('active member with owner role → ok', async () => {
      const memberRow = makeMemberRow('owner');
      const token = await makeAccessToken({ sub: memberRow.user_id, isAdmin: false });
      const request = makeRequest(`Bearer ${token}`);
      const db = makeMockDb([memberRow]);

      const result = await requirePromoterMember(request, promoterId, ['owner', 'admin'], makeDeps(db));

      expect(result.userId).toBe(memberRow.user_id);
      expect(result.promoterId).toBe(promoterId);
      expect(result.member.role).toBe('owner');
      expect(result.member.status).toBe('active');
    });

    it('admin role, required=[owner] → throws INSUFFICIENT_ROLE', async () => {
      const memberRow = makeMemberRow('admin');
      const token = await makeAccessToken({ sub: memberRow.user_id, isAdmin: false });
      const request = makeRequest(`Bearer ${token}`);
      const db = makeMockDb([memberRow]);

      await expect(
        requirePromoterMember(request, promoterId, ['owner'], makeDeps(db))
      ).rejects.toMatchObject({
        code: 'INSUFFICIENT_ROLE',
        status: 403,
      });
    });

    it('not a member → throws NOT_PROMOTER_MEMBER', async () => {
      const token = await makeAccessToken({ isAdmin: false });
      const request = makeRequest(`Bearer ${token}`);
      const db = makeMockDb([]); // empty result

      await expect(
        requirePromoterMember(request, promoterId, ['owner', 'admin'], makeDeps(db))
      ).rejects.toMatchObject({
        code: 'NOT_PROMOTER_MEMBER',
        status: 403,
      });
    });

    it('deactivated member → throws NOT_PROMOTER_MEMBER (query filters by status=active)', async () => {
      const token = await makeAccessToken({ isAdmin: false });
      const request = makeRequest(`Bearer ${token}`);
      // DB returns nothing because query has WHERE status = 'active'
      const db = makeMockDb([]);

      await expect(
        requirePromoterMember(request, promoterId, ['owner', 'admin', 'staff'], makeDeps(db))
      ).rejects.toMatchObject({
        code: 'NOT_PROMOTER_MEMBER',
      });
    });

    it('platform admin (isAdmin=true) → bypass membership check, skips DB', async () => {
      const userId = randomUUID();
      const token = await makeAccessToken({ sub: userId, isAdmin: true });
      const request = makeRequest(`Bearer ${token}`);
      const db = makeMockDb(); // should NOT be called

      const result = await requirePromoterMember(request, promoterId, ['owner'], makeDeps(db));

      expect(result.userId).toBe(userId);
      expect(result.member.role).toBe('owner');
      // DB should not have been queried
      expect(db.query).not.toHaveBeenCalled();
    });

    it('staff role, required=[owner, admin] → throws INSUFFICIENT_ROLE', async () => {
      const memberRow = makeMemberRow('staff');
      const token = await makeAccessToken({ sub: memberRow.user_id, isAdmin: false });
      const request = makeRequest(`Bearer ${token}`);
      const db = makeMockDb([memberRow]);

      await expect(
        requirePromoterMember(request, promoterId, ['owner', 'admin'], makeDeps(db))
      ).rejects.toMatchObject({
        code: 'INSUFFICIENT_ROLE',
      });
    });

    it('DB query uses correct promoter_id and user_id params', async () => {
      const userId = randomUUID();
      const memberRow = { user_id: userId, promoter_id: promoterId, role: 'admin', status: 'active' };
      const token = await makeAccessToken({ sub: userId, isAdmin: false });
      const request = makeRequest(`Bearer ${token}`);
      const db = makeMockDb([memberRow]);

      await requirePromoterMember(request, promoterId, ['admin'], makeDeps(db));

      expect(db.query).toHaveBeenCalledOnce();
      const [, params] = (db.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(params).toContain(promoterId);
      expect(params).toContain(userId);
    });
  });

  // ── extractTokenOptional ──────────────────────────────────────────────────

  describe('extractTokenOptional()', () => {
    it('valid token → returns payload', async () => {
      const userId = randomUUID();
      const token = await makeAccessToken({ sub: userId });
      const request = makeRequest(`Bearer ${token}`);

      const payload = await extractTokenOptional(request);
      expect(payload).not.toBeNull();
      expect(payload!.sub).toBe(userId);
    });

    it('missing Authorization header → returns null (no error thrown)', async () => {
      const request = makeRequest();
      const payload = await extractTokenOptional(request);
      expect(payload).toBeNull();
    });

    it('invalid token → returns null (no error thrown)', async () => {
      const request = makeRequest('Bearer invalid.token.here');
      const payload = await extractTokenOptional(request);
      expect(payload).toBeNull();
    });

    it('expired token → returns null (no error thrown)', async () => {
      const token = await makeAccessToken({ expiredAgo: 3600 });
      const request = makeRequest(`Bearer ${token}`);
      const payload = await extractTokenOptional(request);
      expect(payload).toBeNull();
    });
  });

  // ── extractAndVerifyToken ─────────────────────────────────────────────────

  describe('extractAndVerifyToken()', () => {
    it('returns full AccessTokenPayload on valid token', async () => {
      const userId = randomUUID();
      const token = await makeAccessToken({ sub: userId, isAdmin: true, name: 'Admin User' });
      const request = makeRequest(`Bearer ${token}`);

      const payload = await extractAndVerifyToken(request);
      expect(payload.sub).toBe(userId);
      expect(payload.isAdmin).toBe(true);
      expect(payload.name).toBe('Admin User');
      expect(typeof payload.jti).toBe('string');
      expect(typeof payload.iat).toBe('number');
      expect(typeof payload.exp).toBe('number');
    });
  });
});
