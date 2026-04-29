// Generování a validace jednorázových přístupových tokenů pro Verified Fan.
// Token je signed JWT (HS256) — obsahuje registrationId, eventId, userId a exp.
// Jednorázovost je vynucena přes Redis (po použití token zablokován).

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { AccessLinkPayload } from '../types/verified-fan.types';
import { AccessLinkExpiredError, AccessLinkAlreadyUsedError } from '../types/verified-fan.types';

const ISSUER = 'tixly';
const AUDIENCE = 'tixly-verified-fan';

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
  return new TextEncoder().encode(secret);
}

/**
 * Vygeneruje signed JWT token pro přístup k presale.
 */
export async function generateAccessToken(
  payload: Omit<AccessLinkPayload, 'exp'>,
  expiresAfterHours: number,
): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + expiresAfterHours * 60 * 60 * 1000);

  const token = await new SignJWT({ ...payload } as JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(expiresAt)
    .sign(getSecret());

  return { token, expiresAt };
}

/**
 * Ověří a dekóduje access token.
 * Nekontroluje Redis použití — to musí udělat volající (redeemAccessToken).
 */
export async function verifyAccessToken(token: string): Promise<AccessLinkPayload> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    return payload as unknown as AccessLinkPayload;
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('expired')) {
      throw new AccessLinkExpiredError('Přístupový odkaz vypršel.');
    }
    throw new AccessLinkExpiredError('Neplatný přístupový odkaz.');
  }
}

/**
 * Označí token jako použitý v Redisu.
 * Vrací false pokud byl token již použit (idempotence).
 */
export async function markTokenUsed(
  registrationId: string,
  redis: RedisAdapter,
): Promise<boolean> {
  const key = `tixly:verified-fan:used:${registrationId}`;
  const set = await redis.setNx(key, '1', 60 * 60 * 24 * 7); // TTL 7 dní
  if (!set) {
    throw new AccessLinkAlreadyUsedError('Přístupový odkaz byl již použit.');
  }
  return true;
}

export interface RedisAdapter {
  setNx(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  get?(key: string): Promise<string | null>;
}

/**
 * Validate an access token at checkout.
 *
 * Performs three checks:
 *   1. JWT signature + expiration (via verifyAccessToken)
 *   2. Token belongs to the expected event
 *   3. Token has not been marked as used (Redis lookup, if adapter supports it)
 *
 * Returns a structured result instead of throwing so the caller (checkout
 * flow) can render a user-friendly error.
 */
export async function validateAccessToken(
  token: string,
  eventId: string,
  redis?: RedisAdapter,
): Promise<{ valid: boolean; fanId?: string; reason?: string }> {
  let payload: AccessLinkPayload;
  try {
    payload = await verifyAccessToken(token);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'invalid_token';
    return { valid: false, reason };
  }

  if (payload.eventId !== eventId) {
    return { valid: false, fanId: payload.userId, reason: 'event_mismatch' };
  }

  if (redis && typeof redis.get === 'function') {
    const key = `tixly:verified-fan:used:${payload.registrationId}`;
    const used = await redis.get(key);
    if (used) {
      return { valid: false, fanId: payload.userId, reason: 'already_used' };
    }
  }

  return { valid: true, fanId: payload.userId };
}
