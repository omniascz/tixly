// Buyer blacklist — domain types
// Platform-wide and per-promoter bans with appeal flow and audit log.

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export type BanScope = 'platform' | 'promoter';

export type BanStatus = 'active' | 'appealing' | 'lifted' | 'rejected';

export type AppealDecision = 'approved' | 'rejected';

export type UserRole = 'admin' | 'promoter' | 'buyer' | 'service';

// ---------------------------------------------------------------------------
// Core domain interfaces
// ---------------------------------------------------------------------------

export interface BlacklistEntry {
  id: string;
  userId: string;
  email: string;
  /** null for platform-scope bans */
  promoterId: string | null;
  scope: BanScope;
  reason: string;
  status: BanStatus;
  /** userId of the admin or promoter who issued the ban */
  bannedBy: string;
  bannedAt: Date;
  liftedAt: Date | null;
  liftedBy: string | null;
}

export interface AppealRequest {
  id: string;
  blacklistEntryId: string;
  userId: string;
  message: string;
  createdAt: Date;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  decision: AppealDecision | null;
}

// ---------------------------------------------------------------------------
// Adapter interfaces — injected into services, easy to mock in tests
// ---------------------------------------------------------------------------

export interface DbRow {
  [key: string]: unknown;
}

export type { DbAdapter } from '@tixly/db-adapter';
import type { DbAdapter } from '@tixly/db-adapter';

export interface EventBusAdapter {
  publish(topic: string, payload: unknown): Promise<void>;
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/**
 * 403 — User is banned (platform or promoter scope).
 * Anti-enumeration: returned as a domain error, NOT a 404.
 */
export class UserBannedError extends Error {
  readonly statusCode = 403;
  readonly code = 'USER_BANNED';
  readonly scope: BanScope;
  readonly reason: string;

  constructor(scope: BanScope, reason: string) {
    super(`User is banned (scope: ${scope}). Reason: ${reason}`);
    this.name = 'UserBannedError';
    this.scope = scope;
    this.reason = reason;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/** 409 — An open appeal already exists for this blacklist entry. */
export class AppealAlreadyExistsError extends Error {
  readonly statusCode = 409;
  readonly code = 'APPEAL_ALREADY_EXISTS';

  constructor(entryId: string) {
    super(`An appeal already exists for blacklist entry ${entryId}.`);
    this.name = 'AppealAlreadyExistsError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/** 404 — No active ban found for the given user/entry. */
export class NotBannedError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_BANNED';

  constructor(message = 'No active ban found.') {
    super(message);
    this.name = 'NotBannedError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/** 403 — Caller does not have sufficient privileges for this operation. */
export class InsufficientPrivilegesError extends Error {
  readonly statusCode = 403;
  readonly code = 'INSUFFICIENT_PRIVILEGES';

  constructor(message = 'Insufficient privileges for this operation.') {
    super(message);
    this.name = 'InsufficientPrivilegesError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/** 404 — Blacklist entry not found. */
export class BlacklistEntryNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'BLACKLIST_ENTRY_NOT_FOUND';

  constructor(entryId: string) {
    super(`Blacklist entry ${entryId} not found.`);
    this.name = 'BlacklistEntryNotFoundError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/** 404 — Appeal not found. */
export class AppealNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'APPEAL_NOT_FOUND';

  constructor(appealId: string) {
    super(`Appeal ${appealId} not found.`);
    this.name = 'AppealNotFoundError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP error mapping helper — used by all API route handlers
// ---------------------------------------------------------------------------

type AnyBlacklistError =
  | UserBannedError
  | AppealAlreadyExistsError
  | NotBannedError
  | InsufficientPrivilegesError
  | BlacklistEntryNotFoundError
  | AppealNotFoundError;

function isKnownError(err: unknown): err is AnyBlacklistError {
  return (
    err instanceof UserBannedError ||
    err instanceof AppealAlreadyExistsError ||
    err instanceof NotBannedError ||
    err instanceof InsufficientPrivilegesError ||
    err instanceof BlacklistEntryNotFoundError ||
    err instanceof AppealNotFoundError
  );
}

export function toHttpError(err: unknown): { status: number; body: { error: string; code: string } } {
  if (isKnownError(err)) {
    return {
      status: err.statusCode,
      body: { error: err.message, code: err.code },
    };
  }
  console.error('[buyer-blacklist] Unhandled error:', err);
  return {
    status: 500,
    body: { error: 'Internal server error', code: 'INTERNAL_ERROR' },
  };
}
