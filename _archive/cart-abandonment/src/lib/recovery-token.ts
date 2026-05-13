// Signed JWT recovery token pro obnovu košíku.
// TTL = 7 dní (dostatečná doba pro uživatele reagovat na email).

import { SignJWT, jwtVerify } from 'jose';
import { CartTokenExpiredError } from '../types/cart.types';

const ISSUER = 'tixly';
const AUDIENCE = 'tixly-cart-recovery';
const TTL_HOURS = 7 * 24;   // 7 dní

function secret(): Uint8Array {
  const s = process.env.JWT_SECRET ?? '';
  if (s.length < 32) throw new Error('JWT_SECRET too short');
  return new TextEncoder().encode(s);
}

export async function generateRecoveryToken(cartId: string, userId: string): Promise<string> {
  return new SignJWT({ cartId, userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(`${TTL_HOURS}h`)
    .sign(secret());
}

export async function verifyRecoveryToken(token: string): Promise<{ cartId: string; userId: string }> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER, audience: AUDIENCE });
    return { cartId: payload['cartId'] as string, userId: payload['userId'] as string };
  } catch {
    throw new CartTokenExpiredError('Recovery odkaz vypršel nebo je neplatný.');
  }
}
