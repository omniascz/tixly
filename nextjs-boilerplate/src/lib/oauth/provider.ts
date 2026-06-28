/**
 * Shared OAuth user resolution logic.
 *
 * Find-or-create flow:
 *  1. Look up identity.oauth_accounts by (provider, providerUserId) → fast path
 *  2. Look up identity.users by email → link OAuth to existing account
 *  3. Create new user without password_hash → OAuth-only account
 *
 * After resolving userId, callers issue JWT via signAccessToken / signRefreshToken.
 */

import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import {
  signAccessToken,
  signRefreshToken,
  getUserRoles,
  setAuthCookies,
} from '@/lib/auth';
import { NextResponse } from 'next/server';

export type OAuthProvider = 'google' | 'apple' | 'facebook';

export async function resolveOAuthUser(input: {
  provider: OAuthProvider;
  providerUserId: string;
  email: string;
  name?: string;
}): Promise<{ userId: string; isNew: boolean }> {
  const { provider, providerUserId, email, name } = input;

  return runWithServiceContext(async () => {
    // Fast path: OAuth account already linked
    const existing = await db().query<{ user_id: string }>(
      `SELECT user_id FROM identity.oauth_accounts
       WHERE provider = $1 AND provider_user_id = $2`,
      [provider, providerUserId],
    );

    if (existing.rows.length > 0) {
      // Update provider_email / name in case they changed
      await db().query(
        `UPDATE identity.oauth_accounts
         SET provider_email = $3, provider_name = $4
         WHERE provider = $1 AND provider_user_id = $2`,
        [provider, providerUserId, email, name ?? null],
      );
      return { userId: existing.rows[0].user_id, isNew: false };
    }

    // Slow path: resolve or create user by email
    const byEmail = await db().query<{ id: string }>(
      `SELECT id FROM identity.users
       WHERE email = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [email.toLowerCase()],
    );

    let userId: string;
    let isNew = false;

    if (byEmail.rows.length > 0) {
      userId = byEmail.rows[0].id;
      // Backfill email_verified_at if not set (Google/Apple already verified it)
      await db().query(
        `UPDATE identity.users
         SET email_verified_at = COALESCE(email_verified_at, NOW())
         WHERE id = $1`,
        [userId],
      );
    } else {
      const inserted = await db().query<{ id: string }>(
        `INSERT INTO identity.users (email, name, email_verified_at, gdpr_consent_at)
         VALUES ($1, $2, NOW(), NOW())
         RETURNING id`,
        [email.toLowerCase(), name ?? email.split('@')[0]],
      );
      userId = inserted.rows[0].id;
      isNew = true;
    }

    // Link OAuth account
    await db().query(
      `INSERT INTO identity.oauth_accounts
         (user_id, provider, provider_user_id, provider_email, provider_name)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (provider, provider_user_id) DO NOTHING`,
      [userId, provider, providerUserId, email, name ?? null],
    );

    return { userId, isNew };
  });
}

/** Build redirect response with auth cookies after successful OAuth login. */
export async function oauthLoginResponse(
  userId: string,
  redirectTo: string,
): Promise<Response> {
  const user = await runWithServiceContext(async () => {
    const r = await db().query<{ id: string; email: string; name: string }>(
      `SELECT id, email, COALESCE(name, email) AS name
       FROM identity.users WHERE id = $1`,
      [userId],
    );
    return r.rows[0] ?? null;
  });

  if (!user) {
    return NextResponse.json({ error: 'USER_NOT_FOUND' }, { status: 500 });
  }

  const roles = await getUserRoles(userId);
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(user, roles),
    signRefreshToken(user),
  ]);

  // Refresh token is a signed JWT stored as httpOnly cookie — no DB insert needed.
  // (DB refresh_tokens table is for revocation only, not issuance — matches /api/auth/login pattern.)
  const res = NextResponse.redirect(redirectTo, 302);
  setAuthCookies(res, accessToken, refreshToken);
  return res;
}
