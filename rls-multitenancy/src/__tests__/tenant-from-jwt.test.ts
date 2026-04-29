/**
 * Tests for tenantContextFromJwt
 *
 * Ověřuje:
 * - Admin role přebíjí vše (isAdmin=true)
 * - Promoter role z options.promoterId
 * - Buyer role jako výchozí
 * - userId je vždy z payload.sub
 * - Edge cases: chybějící fields v payloadu
 */

import { describe, it, expect } from 'vitest';
import { tenantContextFromJwt } from '../lib/tenant-from-jwt';
import type { AccessTokenPayload } from '../lib/tenant-from-jwt';

// ─── Test UUIDs ────────────────────────────────────────────────────────────

const USER_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const PROMOTER_UUID = '550e8400-e29b-41d4-a716-446655440000';

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('tenantContextFromJwt', () => {
  // ── Admin role ────────────────────────────────────────────────────────

  it('isAdmin=true → role=admin', () => {
    const payload: AccessTokenPayload = { sub: USER_UUID, isAdmin: true };

    const ctx = tenantContextFromJwt(payload);

    expect(ctx.role).toBe('admin');
  });

  it('isAdmin=true → userId je payload.sub', () => {
    const payload: AccessTokenPayload = { sub: USER_UUID, isAdmin: true };

    const ctx = tenantContextFromJwt(payload);

    expect(ctx.userId).toBe(USER_UUID);
  });

  it('isAdmin=true + options.promoterId → role=admin (admin přebíjí promotera)', () => {
    const payload: AccessTokenPayload = { sub: USER_UUID, isAdmin: true };

    const ctx = tenantContextFromJwt(payload, { promoterId: PROMOTER_UUID });

    expect(ctx.role).toBe('admin');
    // Admin nemá promoterId v kontextu
    expect(ctx.promoterId).toBeUndefined();
  });

  // ── Promoter role ─────────────────────────────────────────────────────

  it('isAdmin=false + options.promoterId → role=promoter', () => {
    const payload: AccessTokenPayload = { sub: USER_UUID, isAdmin: false };

    const ctx = tenantContextFromJwt(payload, { promoterId: PROMOTER_UUID });

    expect(ctx.role).toBe('promoter');
  });

  it('isAdmin=false + options.promoterId → promoterId je nastaveno', () => {
    const payload: AccessTokenPayload = { sub: USER_UUID, isAdmin: false };

    const ctx = tenantContextFromJwt(payload, { promoterId: PROMOTER_UUID });

    expect(ctx.promoterId).toBe(PROMOTER_UUID);
  });

  it('promoter kontext má vždy userId z payload.sub', () => {
    const payload: AccessTokenPayload = { sub: USER_UUID };

    const ctx = tenantContextFromJwt(payload, { promoterId: PROMOTER_UUID });

    expect(ctx.userId).toBe(USER_UUID);
    expect(ctx.role).toBe('promoter');
  });

  // ── Buyer role ────────────────────────────────────────────────────────

  it('isAdmin=false + žádný promoterId → role=buyer', () => {
    const payload: AccessTokenPayload = { sub: USER_UUID, isAdmin: false };

    const ctx = tenantContextFromJwt(payload);

    expect(ctx.role).toBe('buyer');
  });

  it('buyer kontext má userId=payload.sub', () => {
    const payload: AccessTokenPayload = { sub: USER_UUID };

    const ctx = tenantContextFromJwt(payload);

    expect(ctx.userId).toBe(USER_UUID);
    expect(ctx.role).toBe('buyer');
  });

  it('buyer kontext nemá promoterId', () => {
    const payload: AccessTokenPayload = { sub: USER_UUID };

    const ctx = tenantContextFromJwt(payload);

    expect(ctx.promoterId).toBeUndefined();
  });

  // ── Edge cases ────────────────────────────────────────────────────────

  it('payload bez email/name funguje (minimální payload)', () => {
    const payload: AccessTokenPayload = { sub: USER_UUID };

    expect(() => tenantContextFromJwt(payload)).not.toThrow();
    const ctx = tenantContextFromJwt(payload);
    expect(ctx.role).toBe('buyer');
    expect(ctx.userId).toBe(USER_UUID);
  });

  it('payload s extra claims je zpracován správně', () => {
    const payload: AccessTokenPayload = {
      sub: USER_UUID,
      email: 'test@example.com',
      name: 'Test User',
      iat: 1712345678,
      exp: 1712349278,
      customClaim: 'value',
    };

    const ctx = tenantContextFromJwt(payload);

    expect(ctx.role).toBe('buyer');
    expect(ctx.userId).toBe(USER_UUID);
  });

  it('options bez promoterId (prázdný objekt) → role=buyer', () => {
    const payload: AccessTokenPayload = { sub: USER_UUID };

    const ctx = tenantContextFromJwt(payload, {});

    expect(ctx.role).toBe('buyer');
  });
});
