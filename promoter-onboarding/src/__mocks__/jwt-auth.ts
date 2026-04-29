/**
 * Mock for @tixly/jwt-auth (P0-2 module).
 * Used in tests and local development when the real package is not installed.
 */

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthUser {
  userId: string;
  email?: string;
  role?: string;
}

export async function issueTokenPair(userId: string): Promise<TokenPair> {
  return {
    accessToken: `mock.access.${userId}`,
    refreshToken: `mock.refresh.${userId}`,
  };
}

export async function requireUser(request: { headers: { get(name: string): string | null } }): Promise<AuthUser> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Unauthorized');
  }
  const token = authHeader.slice(7);
  // In mock: token IS the userId
  return { userId: token };
}

export async function requireAdmin(request: { headers: { get(name: string): string | null } }): Promise<AuthUser> {
  const adminId = request.headers.get('x-admin-user-id');
  if (!adminId) {
    throw new Error('Admin authorization required');
  }
  return { userId: adminId, role: 'admin' };
}

export async function verifyAccessToken(token: string): Promise<AuthUser> {
  if (!token) throw new Error('Invalid token');
  return { userId: token };
}
