import { AuthError } from './auth-errors';
import { verifyAccessToken } from '../services/jwt.service';
import type { ServiceDeps } from './service-container';
import type { AccessTokenPayload, MemberRole, PromoterMember } from '../types/auth';

/**
 * Extracts Bearer token from Authorization header and verifies it.
 * Throws AuthError on any failure.
 */
export async function extractAndVerifyToken(
  request: Request
): Promise<AccessTokenPayload> {
  const authHeader = request.headers.get('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthError('TOKEN_MISSING');
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    throw new AuthError('TOKEN_MISSING');
  }

  // verifyAccessToken throws TOKEN_EXPIRED or TOKEN_INVALID on failure
  return verifyAccessToken(token);
}

/**
 * Requires any authenticated user.
 * Returns userId, email, isAdmin from the verified JWT.
 */
export async function requireUser(
  request: Request
): Promise<{ userId: string; email: string; isAdmin: boolean }> {
  const payload = await extractAndVerifyToken(request);
  return { userId: payload.sub, email: payload.email, isAdmin: payload.isAdmin };
}

/**
 * Requires platform admin access.
 * Throws ADMIN_REQUIRED (403) if the user is not an admin.
 */
export async function requireAdmin(
  request: Request
): Promise<{ userId: string }> {
  const payload = await extractAndVerifyToken(request);

  if (!payload.isAdmin) {
    throw new AuthError('ADMIN_REQUIRED');
  }

  return { userId: payload.sub };
}

/**
 * Requires the user to be an active member of the given promoter with one of the required roles.
 *
 * Admin bypass: if payload.isAdmin === true, skips DB lookup and grants access unconditionally.
 */
export async function requirePromoterMember(
  request: Request,
  promoterId: string,
  requiredRoles: MemberRole[],
  deps: ServiceDeps
): Promise<{ userId: string; promoterId: string; member: PromoterMember }> {
  const payload = await extractAndVerifyToken(request);

  // Platform admins bypass membership checks
  if (payload.isAdmin) {
    const syntheticMember: PromoterMember = {
      userId: payload.sub,
      promoterId,
      role: 'owner',
      status: 'active',
    };
    return { userId: payload.sub, promoterId, member: syntheticMember };
  }

  interface MemberRow {
    user_id: string;
    promoter_id: string;
    role: MemberRole;
    status: 'active' | 'invited' | 'deactivated';
  }

  const rows = await deps.db.query<MemberRow>(
    `SELECT user_id, promoter_id, role, status
     FROM platform.promoter_members
     WHERE promoter_id = $1 AND user_id = $2 AND status = 'active'
     LIMIT 1`,
    [promoterId, payload.sub]
  );

  const row = rows[0] ?? null;

  if (!row) {
    throw new AuthError('NOT_PROMOTER_MEMBER');
  }

  if (!requiredRoles.includes(row.role)) {
    throw new AuthError('INSUFFICIENT_ROLE');
  }

  const member: PromoterMember = {
    userId: row.user_id,
    promoterId: row.promoter_id,
    role: row.role,
    status: row.status,
  };

  return { userId: payload.sub, promoterId, member };
}

/**
 * Attempts to extract and verify Bearer token.
 * Returns null instead of throwing if the token is missing or invalid.
 * Useful for optional authentication endpoints.
 */
export async function extractTokenOptional(
  request: Request
): Promise<AccessTokenPayload | null> {
  try {
    return await extractAndVerifyToken(request);
  } catch {
    return null;
  }
}
