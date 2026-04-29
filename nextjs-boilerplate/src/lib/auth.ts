import { SignJWT, jwtVerify, JWTPayload } from 'jose';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me-min-32-chars-please';
const ACCESS_TTL = parseInt(process.env.JWT_ACCESS_TOKEN_TTL ?? '900', 10);
const REFRESH_TTL = parseInt(process.env.JWT_REFRESH_TOKEN_TTL ?? '604800', 10);
const secretKey = new TextEncoder().encode(JWT_SECRET);

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

let pool: Pool | null = null;
export function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function getUserRoles(userId: string): Promise<UserRoles> {
  const adminRow = await db().query<{ is_platform_admin: boolean }>(
    'SELECT is_platform_admin FROM identity.users WHERE id = $1',
    [userId],
  );
  const isPlatformAdmin = adminRow.rows[0]?.is_platform_admin ?? false;

  const memberRows = await db().query<{
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
}

export async function signAccessToken(user: AuthUser, roles: UserRoles): Promise<string> {
  return new SignJWT({
    sub: user.id,
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
    .sign(secretKey);
}

export async function signRefreshToken(user: AuthUser): Promise<string> {
  return new SignJWT({ sub: user.id, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${REFRESH_TTL}s`)
    .sign(secretKey);
}

export async function verifyToken(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, secretKey);
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
    httpOnly: false,
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
