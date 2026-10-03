import bcrypt from 'bcryptjs';
import { TOKEN_TYPE_ACCESS, TOKEN_TYPE_REFRESH } from '@/lib/security/token-type';
import { SignJWT, jwtVerify, JWTPayload } from 'jose';
import { NextResponse, type NextRequest } from 'next/server';
import { db as rlsDb, runWithUserContext, runWithServiceContext } from './db/rls-pool';

const ACCESS_TTL = parseInt(process.env.JWT_ACCESS_TOKEN_TTL ?? '900', 10);
const REFRESH_TTL = parseInt(process.env.JWT_REFRESH_TOKEN_TTL ?? '604800', 10);

/**
 * JWT secret se vyhodnocuje LAZY (ne při module-load), aby build nepadal, když
 * env není v build fázi. V PRODUKCI je povinný a min. 32 znaků (shodně s
 * middleware) — žádný hardcoded fallback (jinak by šel forgnout admin token).
 * V dev/test fallback zůstává kvůli lokálnímu běhu a testům.
 */
function getSecretKey(): Uint8Array {
  let secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET missing or too short in production (min 32 chars)');
    }
    secret = 'dev-secret-change-me-min-32-chars-please';
  }
  return new TextEncoder().encode(secret);
}

export interface PromoterMembership {
  promoterId: string;
  promoterSlug: string;
  promoterName: string;
  status: 'pending' | 'active' | 'suspended';
  role: string;
}

export interface UserRoles {
  isPlatformAdmin: boolean;
  promoterMemberships: PromoterMembership[];
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

/**
 * Buyer / user RLS wrapper (RLS Fáze 2). Doplňuje trojici k runAsPromoter
 * (admin-auth.ts) a runAsPlatformAdmin (platform-auth.ts). Použití v buyer
 * route handlerech (orders, tickets, my-tickets), které isolují přes
 * app.current_user_id:
 *
 *   export async function GET(req: NextRequest) {
 *     return runAsUser(req, async (userId) => {
 *       const r = await db().query('SELECT * FROM orders.orders'); // db() z rls-pool
 *       return NextResponse.json(r.rows);
 *     });
 *   }
 *
 * Identitu bere z hlavičky x-user-id (nastaví ji JWT middleware). Bez ní → 401.
 */
export async function runAsUser<T>(
  req: NextRequest,
  callback: (userId: string) => Promise<T>,
): Promise<T | Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  return runWithUserContext(userId, async () => callback(userId));
}

export async function getUserRoles(userId: string): Promise<UserRoles> {
  // Pre-auth identity resolution — čte promoter_members (RLS) dřív, než vznikne
  // user kontext (bootstrap). Trusted operace → service kontext.
  return runWithServiceContext(async () => {
  const adminRow = await rlsDb().query<{ is_platform_admin: boolean }>(
    'SELECT is_platform_admin FROM identity.users WHERE id = $1',
    [userId],
  );
  const isPlatformAdmin = adminRow.rows[0]?.is_platform_admin ?? false;

  const memberRows = await rlsDb().query<{
    promoter_id: string;
    slug: string;
    name: string;
    status: 'pending' | 'active' | 'suspended';
    role: string;
  }>(
    `SELECT pm.promoter_id, p.slug, p.name, p.status, pm.role::text AS role
     FROM platform.promoter_members pm
     JOIN platform.promoters p ON p.id = pm.promoter_id
     WHERE pm.user_id = $1`,
    [userId],
  );

  return {
    isPlatformAdmin,
    promoterMemberships: memberRows.rows.map((r) => ({
      promoterId: r.promoter_id,
      promoterSlug: r.slug,
      promoterName: r.name,
      status: r.status,
      role: r.role,
    })),
  };
  });
}

export async function signAccessToken(user: AuthUser, roles: UserRoles): Promise<string> {
  return new SignJWT({
    sub: user.id,
    // FIX K4d: typ tokenu — ověřování přihlášení bere jen `access` (lib/security/token-type).
    type: TOKEN_TYPE_ACCESS,
    email: user.email,
    name: user.name,
    isAdmin: roles.isPlatformAdmin,
    roles: {
      isPlatformAdmin: roles.isPlatformAdmin,
      promoterMemberships: roles.promoterMemberships.map((m) => ({
        promoterId: m.promoterId,
        status: m.status,
        role: m.role,
      })),
    },
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL}s`)
    .sign(getSecretKey());
}

export async function signRefreshToken(user: AuthUser): Promise<string> {
  return new SignJWT({ sub: user.id, type: TOKEN_TYPE_REFRESH })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${REFRESH_TTL}s`)
    .sign(getSecretKey());
}

export async function verifyToken(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, getSecretKey());
  return payload;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function setAuthCookies(
  res: import('next/server').NextResponse,
  accessToken: string,
  refreshToken: string,
): void {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookies.set('accessToken', accessToken, {
    // httpOnly: true — JWT nesmí být čitelný z JS (XSS by ho jinak ukradl).
    // Klient posílá Bearer z localStorage (z těla login response), cookie čte
    // jen middleware server-side; logout maže cookie serverově (/api/auth/logout).
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: ACCESS_TTL,
    path: '/',
  });
  res.cookies.set('refreshToken', refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: REFRESH_TTL,
    path: '/',
  });
}
