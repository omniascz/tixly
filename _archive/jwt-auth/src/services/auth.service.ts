import { randomUUID } from 'crypto';
import { AuthError } from '../lib/auth-errors';
import type { ServiceDeps } from '../lib/service-container';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from './jwt.service';
import type { TokenPair, UserRecord, RefreshTokenRecord } from '../types/auth';

// In production, password hash uses bcrypt with cost factor 12.
// bcrypt.compare(password, hash) is used here; in tests this is mocked via vi.fn().
import bcrypt from 'bcryptjs';

export async function login(
  email: string,
  password: string,
  deps: ServiceDeps
): Promise<TokenPair> {
  // Fetch user — always run bcrypt even on miss to prevent timing attacks
  const users = await deps.db.query<UserRecord>(
    `SELECT id, email, name, password_hash, is_admin FROM identity.users WHERE email = $1 LIMIT 1`,
    [email]
  );

  const user = users[0] ?? null;

  // Use a dummy hash when user not found to ensure constant time
  const hashToCheck = user?.password_hash ?? '$2b$12$invalidhashplaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

  const passwordValid = await bcrypt.compare(password, hashToCheck);

  if (!user || !passwordValid) {
    // Return the same error for both missing user and wrong password (timing-safe)
    throw new AuthError('USER_NOT_FOUND', 'Invalid credentials');
  }

  const family = randomUUID();
  const { token: refreshToken, jti } = await signRefreshToken(user.id, family);

  // Refresh token TTL: 7 days
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await deps.db.execute(
    `INSERT INTO identity.refresh_tokens (jti, user_id, family, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [jti, user.id, family, expiresAt]
  );

  const accessToken = await signAccessToken({
    sub: user.id,
    email: user.email,
    name: user.name,
    isAdmin: user.is_admin,
  });

  return { accessToken, refreshToken, expiresIn: 900 };
}

export async function refresh(
  refreshToken: string,
  deps: ServiceDeps
): Promise<TokenPair> {
  // Verify JWT signature and expiry first
  const payload = await verifyRefreshToken(refreshToken);

  // Load DB record
  const records = await deps.db.query<RefreshTokenRecord>(
    `SELECT jti, user_id, family, is_revoked, expires_at
     FROM identity.refresh_tokens
     WHERE jti = $1
     LIMIT 1`,
    [payload.jti]
  );

  const record = records[0] ?? null;

  if (!record) {
    // Token not in DB — treat as revoked
    throw new AuthError('TOKEN_REVOKED');
  }

  if (record.is_revoked) {
    // Token reuse detected — revoke entire family (security event)
    console.warn(
      `[SECURITY] REFRESH_TOKEN_REUSE detected. family=${record.family} jti=${record.jti} user_id=${record.user_id}`
    );
    await deps.db.execute(
      `UPDATE identity.refresh_tokens SET is_revoked = TRUE WHERE family = $1`,
      [record.family]
    );
    throw new AuthError('REFRESH_TOKEN_REUSE');
  }

  // Revoke old refresh token
  await deps.db.execute(
    `UPDATE identity.refresh_tokens SET is_revoked = TRUE WHERE jti = $1`,
    [record.jti]
  );

  // Fetch user for access token payload
  const users = await deps.db.query<UserRecord>(
    `SELECT id, email, name, is_admin FROM identity.users WHERE id = $1 LIMIT 1`,
    [record.user_id]
  );

  const user = users[0] ?? null;
  if (!user) {
    throw new AuthError('USER_NOT_FOUND');
  }

  // Issue new refresh token in same family (refresh token rotation)
  const { token: newRefreshToken, jti: newJti } = await signRefreshToken(
    user.id,
    record.family
  );

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await deps.db.execute(
    `INSERT INTO identity.refresh_tokens (jti, user_id, family, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [newJti, user.id, record.family, expiresAt]
  );

  const accessToken = await signAccessToken({
    sub: user.id,
    email: user.email,
    name: user.name,
    isAdmin: user.is_admin,
  });

  return { accessToken, refreshToken: newRefreshToken, expiresIn: 900 };
}

export async function logout(
  refreshToken: string,
  deps: ServiceDeps
): Promise<void> {
  // Verify JWT to extract jti (ignore expiry errors — still revoke)
  let jti: string;
  try {
    const payload = await verifyRefreshToken(refreshToken);
    jti = payload.jti;
  } catch {
    // If we can't decode the token, nothing to revoke
    return;
  }

  await deps.db.execute(
    `UPDATE identity.refresh_tokens SET is_revoked = TRUE WHERE jti = $1`,
    [jti]
  );
}

export async function logoutAll(userId: string, deps: ServiceDeps): Promise<void> {
  await deps.db.execute(
    `UPDATE identity.refresh_tokens SET is_revoked = TRUE WHERE user_id = $1`,
    [userId]
  );
}

export async function cleanupExpiredTokens(deps: ServiceDeps): Promise<number> {
  // Delete revoked tokens that have already expired — no need to keep them
  const result = await deps.db.query<{ count: string }>(
    `WITH deleted AS (
       DELETE FROM identity.refresh_tokens
       WHERE expires_at < NOW() AND is_revoked = TRUE
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM deleted`,
    []
  );

  return parseInt(result[0]?.count ?? '0', 10);
}
