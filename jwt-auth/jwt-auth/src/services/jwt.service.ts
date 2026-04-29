import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { randomUUID } from 'crypto';
import { AuthError } from '../lib/auth-errors';
import type { AccessTokenPayload, RefreshTokenPayload } from '../types/auth';

// Access token TTL: 15 minutes
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 900s

// Refresh token TTL: 7 days
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 604800s

const ALGORITHM = 'HS256';

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'JWT_SECRET environment variable is missing or too short (minimum 32 characters required)'
    );
  }
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(
  payload: Omit<AccessTokenPayload, 'iat' | 'exp' | 'jti'>
): Promise<string> {
  const secret = getSecret();
  const jti = randomUUID();
  const now = Math.floor(Date.now() / 1000);

  const token = await new SignJWT({
    sub: payload.sub,
    email: payload.email,
    name: payload.name,
    isAdmin: payload.isAdmin,
    jti,
  })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_TTL_SECONDS)
    .setIssuer('tixly')
    .setAudience('tixly-api')
    .sign(secret);

  return token;
}

export async function signRefreshToken(
  userId: string,
  family: string
): Promise<{ token: string; jti: string }> {
  const secret = getSecret();
  const jti = randomUUID();
  const now = Math.floor(Date.now() / 1000);

  const token = await new SignJWT({
    sub: userId,
    jti,
    family,
  })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt(now)
    .setExpirationTime(now + REFRESH_TOKEN_TTL_SECONDS)
    .setIssuer('tixly')
    .setAudience('tixly-api')
    .sign(secret);

  return { token, jti };
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const secret = getSecret();

  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: [ALGORITHM],
      issuer: 'tixly',
      audience: 'tixly-api',
    });

    return extractAccessPayload(payload);
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.name === 'JWTExpired') {
        throw new AuthError('TOKEN_EXPIRED');
      }
    }
    throw new AuthError('TOKEN_INVALID');
  }
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
  const secret = getSecret();

  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: [ALGORITHM],
      issuer: 'tixly',
      audience: 'tixly-api',
    });

    return extractRefreshPayload(payload);
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.name === 'JWTExpired') {
        throw new AuthError('TOKEN_EXPIRED');
      }
    }
    throw new AuthError('TOKEN_INVALID');
  }
}

function extractAccessPayload(payload: JWTPayload): AccessTokenPayload {
  const { sub, email, name, isAdmin, iat, exp, jti } = payload as JWTPayload & {
    email: string;
    name: string;
    isAdmin: boolean;
  };

  if (
    typeof sub !== 'string' ||
    typeof email !== 'string' ||
    typeof name !== 'string' ||
    typeof isAdmin !== 'boolean' ||
    typeof iat !== 'number' ||
    typeof exp !== 'number' ||
    typeof jti !== 'string'
  ) {
    throw new AuthError('TOKEN_INVALID');
  }

  return { sub, email, name, isAdmin, iat, exp, jti };
}

function extractRefreshPayload(payload: JWTPayload): RefreshTokenPayload {
  const { sub, jti, family, iat, exp } = payload as JWTPayload & { family: string };

  if (
    typeof sub !== 'string' ||
    typeof jti !== 'string' ||
    typeof family !== 'string' ||
    typeof iat !== 'number' ||
    typeof exp !== 'number'
  ) {
    throw new AuthError('TOKEN_INVALID');
  }

  return { sub, jti, family, iat, exp };
}
