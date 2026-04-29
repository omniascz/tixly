import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from '../services/jwt.service';
import { AuthError } from '../lib/auth-errors';

const VALID_SECRET = 'super-secret-key-that-is-at-least-32-chars!!';

describe('JwtService', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = VALID_SECRET;
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
    vi.restoreAllMocks();
  });

  // ── Access token ──────────────────────────────────────────────────────────

  it('signAccessToken + verifyAccessToken: round-trip succeeds', async () => {
    const userId = randomUUID();
    const token = await signAccessToken({
      sub: userId,
      email: 'test@example.com',
      name: 'Test User',
      isAdmin: false,
    });

    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);

    const payload = await verifyAccessToken(token);
    expect(payload.sub).toBe(userId);
    expect(payload.email).toBe('test@example.com');
    expect(payload.name).toBe('Test User');
    expect(payload.isAdmin).toBe(false);
  });

  it('signAccessToken payload contains jti as UUID', async () => {
    const token = await signAccessToken({
      sub: randomUUID(),
      email: 'a@b.com',
      name: 'X',
      isAdmin: false,
    });
    const payload = await verifyAccessToken(token);
    expect(payload.jti).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it('signAccessToken generates unique jti for each call', async () => {
    const params = { sub: randomUUID(), email: 'a@b.com', name: 'X', isAdmin: false };
    const t1 = await signAccessToken(params);
    const t2 = await signAccessToken(params);
    const p1 = await verifyAccessToken(t1);
    const p2 = await verifyAccessToken(t2);
    expect(p1.jti).not.toBe(p2.jti);
  });

  it('signAccessToken includes correct isAdmin=true', async () => {
    const token = await signAccessToken({
      sub: randomUUID(),
      email: 'admin@example.com',
      name: 'Admin',
      isAdmin: true,
    });
    const payload = await verifyAccessToken(token);
    expect(payload.isAdmin).toBe(true);
  });

  it('verifyAccessToken throws TOKEN_EXPIRED for expired token', async () => {
    // Create token with already-expired time by mocking Date
    const now = Date.now();
    // Sign with expiry in the past: set iat/exp manually via jose
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode(VALID_SECRET);
    const expiredToken = await new SignJWT({
      sub: randomUUID(),
      email: 'x@x.com',
      name: 'X',
      isAdmin: false,
      jti: randomUUID(),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(now / 1000) - 3600)
      .setExpirationTime(Math.floor(now / 1000) - 1800) // expired 30 min ago
      .sign(secret);

    await expect(verifyAccessToken(expiredToken)).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED',
    });
  });

  it('verifyAccessToken throws TOKEN_INVALID for bad signature', async () => {
    const token = await signAccessToken({
      sub: randomUUID(),
      email: 'x@x.com',
      name: 'X',
      isAdmin: false,
    });

    // Tamper with the signature (last segment)
    const parts = token.split('.');
    parts[2] = parts[2].split('').reverse().join('');
    const tampered = parts.join('.');

    await expect(verifyAccessToken(tampered)).rejects.toMatchObject({
      code: 'TOKEN_INVALID',
    });
  });

  it('verifyAccessToken throws TOKEN_INVALID for token signed with wrong secret', async () => {
    const { SignJWT } = await import('jose');
    const wrongSecret = new TextEncoder().encode('a-completely-different-secret-key-32chars');
    const token = await new SignJWT({
      sub: randomUUID(),
      email: 'x@x.com',
      name: 'X',
      isAdmin: false,
      jti: randomUUID(),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(wrongSecret);

    await expect(verifyAccessToken(token)).rejects.toMatchObject({
      code: 'TOKEN_INVALID',
    });
  });

  // ── Refresh token ─────────────────────────────────────────────────────────

  it('signRefreshToken + verifyRefreshToken: round-trip succeeds', async () => {
    const userId = randomUUID();
    const family = randomUUID();
    const { token, jti } = await signRefreshToken(userId, family);

    expect(typeof token).toBe('string');
    const payload = await verifyRefreshToken(token);
    expect(payload.sub).toBe(userId);
    expect(payload.family).toBe(family);
    expect(payload.jti).toBe(jti);
  });

  it('signRefreshToken returns unique jti each call', async () => {
    const userId = randomUUID();
    const family = randomUUID();
    const r1 = await signRefreshToken(userId, family);
    const r2 = await signRefreshToken(userId, family);
    expect(r1.jti).not.toBe(r2.jti);
  });

  it('verifyRefreshToken throws TOKEN_INVALID for tampered token', async () => {
    const { token } = await signRefreshToken(randomUUID(), randomUUID());
    const parts = token.split('.');
    parts[1] = Buffer.from('{"sub":"fake","jti":"x","family":"y","iat":0,"exp":9999999999}').toString('base64url');
    const tampered = parts.join('.');
    await expect(verifyRefreshToken(tampered)).rejects.toMatchObject({
      code: 'TOKEN_INVALID',
    });
  });

  // ── Missing JWT_SECRET ────────────────────────────────────────────────────

  it('signAccessToken throws when JWT_SECRET is missing', async () => {
    delete process.env.JWT_SECRET;
    await expect(
      signAccessToken({ sub: randomUUID(), email: 'x@x.com', name: 'X', isAdmin: false })
    ).rejects.toThrow();
  });

  it('verifyAccessToken throws when JWT_SECRET is too short', async () => {
    process.env.JWT_SECRET = 'short';
    await expect(verifyAccessToken('any.token.here')).rejects.toThrow();
  });

  // ── iss + aud claims ──────────────────────────────────────────────────────

  it('rejects token without issuer claim', async () => {
    // Token podepsaný správným klíčem, ale bez iss/aud — nesmí projít verifikací
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode(VALID_SECRET);
    const tokenNoIss = await new SignJWT({
      sub: randomUUID(),
      email: 'x@x.com',
      name: 'X',
      isAdmin: false,
      jti: randomUUID(),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('15m')
      // záměrně nepřidáváme setIssuer() ani setAudience()
      .sign(secret);

    await expect(verifyAccessToken(tokenNoIss)).rejects.toMatchObject({
      code: 'TOKEN_INVALID',
    });
  });

  it('rejects token with wrong issuer claim', async () => {
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode(VALID_SECRET);
    const tokenWrongIss = await new SignJWT({
      sub: randomUUID(),
      email: 'x@x.com',
      name: 'X',
      isAdmin: false,
      jti: randomUUID(),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .setIssuer('some-other-service')
      .setAudience('tixly-api')
      .sign(secret);

    await expect(verifyAccessToken(tokenWrongIss)).rejects.toMatchObject({
      code: 'TOKEN_INVALID',
    });
  });

  it('signAccessToken token contains correct iss and aud claims', async () => {
    const { decodeJwt } = await import('jose');
    const token = await signAccessToken({
      sub: randomUUID(),
      email: 'x@x.com',
      name: 'X',
      isAdmin: false,
    });
    const raw = decodeJwt(token);
    expect(raw.iss).toBe('tixly');
    expect(raw.aud).toContain('tixly-api');
  });
});
