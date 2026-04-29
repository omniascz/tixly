export interface AccessTokenPayload {
  sub: string;      // userId (UUID)
  email: string;
  name: string;
  isAdmin: boolean; // platform admin flag
  iat: number;      // issued at
  exp: number;      // expiry
  jti: string;      // JWT ID (UUID) — pro revokaci
}

export interface RefreshTokenPayload {
  sub: string;    // userId
  jti: string;    // JWT ID
  family: string; // UUID — refresh token family (pro detekci reuse)
  iat: number;
  exp: number;
}

export type MemberRole = 'owner' | 'admin' | 'staff';

export interface PromoterMember {
  userId: string;
  promoterId: string;
  role: MemberRole;
  status: 'active' | 'invited' | 'deactivated';
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: 900;
}

export interface RefreshTokenRecord {
  jti: string;
  user_id: string;
  family: string;
  is_revoked: boolean;
  created_at: string;
  expires_at: string;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  is_admin: boolean;
}
