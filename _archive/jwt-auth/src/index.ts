// Public API of @tixly/jwt-auth
// Other modules import from here.

// Auth helpers — main interface for route handlers
export {
  extractAndVerifyToken,
  requireUser,
  requireAdmin,
  requirePromoterMember,
  extractTokenOptional,
} from './lib/auth-helpers';

// Typed errors
export { AuthError, getStatusCode } from './lib/auth-errors';
export type { AuthErrorCode, HttpError } from './lib/auth-errors';

// Types
export type {
  AccessTokenPayload,
  RefreshTokenPayload,
  MemberRole,
  PromoterMember,
  TokenPair,
} from './types/auth';

// Service container types for DI
export type { DbAdapter, ServiceDeps } from './lib/service-container';

// Auth service — for auth routes and cron
export {
  login,
  refresh,
  logout,
  logoutAll,
  cleanupExpiredTokens,
} from './services/auth.service';

// JWT service — for advanced use cases
export {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from './services/jwt.service';

// Zod schemas — for body validation in consumers
export {
  LoginBodySchema,
  RefreshBodySchema,
  LogoutBodySchema,
} from './lib/zod-schemas';
export type { LoginBody, RefreshBody, LogoutBody } from './lib/zod-schemas';
