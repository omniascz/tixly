import { NextRequest, NextResponse } from 'next/server';
import { isRefreshTokenPayload } from '@/lib/security/token-type';
import {
  signAccessToken,
  verifyToken,
  getUserRoles,
  setAuthCookies,
  signRefreshToken,
} from '@/lib/auth';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

interface UserRow {
  id: string;
  email: string;
  name: string;
}

export async function POST(request: NextRequest): Promise<Response> {
  const refreshToken = request.cookies.get('refreshToken')?.value;
  if (!refreshToken) {
    return NextResponse.json({ error: 'No refresh token' }, { status: 401 });
  }

  let payload;
  try {
    payload = await verifyToken(refreshToken);
  } catch {
    return NextResponse.json({ error: 'Invalid refresh token' }, { status: 401 });
  }

  if (!isRefreshTokenPayload(payload) || !payload.sub) {
    return NextResponse.json({ error: 'Invalid token type' }, { status: 401 });
  }

  // Pre-context (validace refresh tokenu) → service.
  const result = await runWithServiceContext(() =>
    db().query<UserRow>(
      'SELECT id, email, name FROM identity.users WHERE id = $1 LIMIT 1',
      [payload.sub],
    ),
  );
  if (result.rows.length === 0) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const user = result.rows[0];
  const roles = await getUserRoles(user.id);
  const accessToken = await signAccessToken(user, roles);
  const newRefresh = await signRefreshToken(user);

  const res = NextResponse.json({ user, roles, accessToken });
  setAuthCookies(res, accessToken, newRefresh);
  return res;
}

/**
 * GET varianta — tichý refresh s přesměrováním (volá ji middleware, když
 * accessToken vyprší ale refreshToken platí). Vystaví nový accessToken z DB rolí
 * a přesměruje zpět na původní stránku, místo aby promotéra vyhodil na login.
 */
export async function GET(request: NextRequest): Promise<Response> {
  // Bezpečný redirect: jen same-origin relativní cesta (ochrana proti open-redirect).
  const raw = request.nextUrl.searchParams.get('redirect') ?? '/admin';
  const target = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/admin';
  const loginUrl = new URL('/cs/login', request.url);
  loginUrl.searchParams.set('from', target);

  const refreshToken = request.cookies.get('refreshToken')?.value;
  if (!refreshToken) return NextResponse.redirect(loginUrl);

  let payload;
  try {
    payload = await verifyToken(refreshToken);
  } catch {
    return NextResponse.redirect(loginUrl);
  }
  if (!isRefreshTokenPayload(payload) || !payload.sub) {
    return NextResponse.redirect(loginUrl);
  }

  const result = await runWithServiceContext(() =>
    db().query<UserRow>(
      'SELECT id, email, name FROM identity.users WHERE id = $1 LIMIT 1',
      [payload.sub],
    ),
  );
  if (result.rows.length === 0) return NextResponse.redirect(loginUrl);

  const user = result.rows[0];
  const roles = await getUserRoles(user.id);
  const accessToken = await signAccessToken(user, roles);
  const newRefresh = await signRefreshToken(user);

  const res = NextResponse.redirect(new URL(target, request.url));
  setAuthCookies(res, accessToken, newRefresh);
  return res;
}
