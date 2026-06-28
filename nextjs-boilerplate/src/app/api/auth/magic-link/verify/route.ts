/**
 * GET /api/auth/magic-link/verify?token=xxx&locale=cs&next=/cs/events
 *
 * Ověří jednoúčelový token, vydá JWT cookies (stejný pattern jako /api/auth/login),
 * přesměruje na cílovou stránku.
 *
 * Bezpečnostní záruky:
 *   - Token je SHA-256 hash plaintextu — žádné bcrypt scanning
 *   - Atomický UPDATE ... WHERE used_at IS NULL RETURNING id zabraňuje race condition
 *   - TTL 15 minut, jednorázové použití
 */

import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import {
  signAccessToken,
  signRefreshToken,
  setAuthCookies,
  getUserRoles,
} from '@/lib/auth';

export const dynamic = 'force-dynamic';

const ALLOWED_LOCALES = new Set(['cs', 'sk', 'en']);

function sha256hex(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

function safeNext(next: string | null, locale: string): string {
  if (!next) return `/${locale}/events`;
  // Povol pouze interní relativní cesty (ochrana před open redirect)
  if (!next.startsWith('/') || next.startsWith('//')) return `/${locale}/events`;
  return next;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {
    const { searchParams } = new URL(req.url);
    const tokenPlain = searchParams.get('token');
    const locale = ALLOWED_LOCALES.has(searchParams.get('locale') ?? '') ? (searchParams.get('locale') as string) : 'cs';
    const next = safeNext(searchParams.get('next'), locale);

    if (!tokenPlain || tokenPlain.length !== 64) {
      return errorRedirect(locale, 'Neplatný odkaz.');
    }

    const tokenHash = sha256hex(tokenPlain);

    // Atomicky označ token jako použitý (race condition safe)
    const markRes = await db().query<{ id: string; user_id: string }>(
      `UPDATE identity.magic_link_tokens
       SET used_at = NOW()
       WHERE token_hash = $1
         AND used_at IS NULL
         AND expires_at > NOW()
       RETURNING id, user_id`,
      [tokenHash],
    );

    if (markRes.rows.length === 0) {
      return errorRedirect(locale, 'Odkaz vypršel nebo již byl použit. Požádej o nový.');
    }

    const userId = markRes.rows[0].user_id;

    // Načti uživatele
    const userRes = await db().query<{ id: string; email: string; name: string | null }>(
      `SELECT id, email, name FROM identity.users
       WHERE id = $1 AND deleted_at IS NULL AND anonymized_at IS NULL
       LIMIT 1`,
      [userId],
    );
    if (userRes.rows.length === 0) {
      return errorRedirect(locale, 'Účet nebyl nalezen.');
    }
    const u = userRes.rows[0];
    const user = { id: u.id, email: u.email, name: u.name ?? '' };

    // Označ email jako ověřený (magic link = prokázání vlastnictví emailu)
    await db().query(
      `UPDATE identity.users
       SET email_verified_at = COALESCE(email_verified_at, NOW())
       WHERE id = $1`,
      [userId],
    );

    // Vydej JWT — stejný flow jako /api/auth/login
    const roles = await getUserRoles(userId);
    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken(user, roles),
      signRefreshToken(user),
    ]);

    // Cílová URL dle rolí (pokud next nespecifikovaný)
    let target = next;
    if (next === `/${locale}/events`) {
      if (roles.isPlatformAdmin) target = '/platform';
      else if ((roles.promoterMemberships?.length ?? 0) > 0) target = '/admin';
    }

    const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const redirectUrl = target.startsWith('http') ? target : `${appUrl}${target}`;

    const res = NextResponse.redirect(redirectUrl, { status: 302 });
    setAuthCookies(res, accessToken, refreshToken);

    // accessToken do cookie — klient si ho při prvním render přečte z cookie nebo z body
    // Protože jdeme přes redirect, pošleme ho jako URL fragment (není bezpečný) NEBO
    // necháme klienta načíst /api/auth/me po redirectu. Volíme druhou možnost —
    // cookies jsou httpOnly a middleware je přečte automaticky.
    return res;
  });
}

function errorRedirect(locale: string, message: string): NextResponse {
  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const params = new URLSearchParams({ error: message });
  return NextResponse.redirect(`${appUrl}/${locale}/login?${params.toString()}`, { status: 302 });
}
