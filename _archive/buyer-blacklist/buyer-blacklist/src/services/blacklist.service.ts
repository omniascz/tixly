/**
 * Blacklist service — platform-wide and per-promoter buyer bans.
 *
 * Design decisions:
 *   - Platform bans: only 'admin' role can ban/lift.
 *   - Promoter bans: 'promoter' role may ban/lift within their own scope.
 *   - checkBan returns null (NOT an error) when no ban exists — anti-enumeration.
 *   - submitAppeal uses INSERT ... ON CONFLICT DO NOTHING for idempotency;
 *     if a row already exists it throws AppealAlreadyExistsError.
 *   - reviewAppeal 'approved' → automatically calls liftBan.
 *   - Kafka events published for ban and lift actions.
 */

import type {
  BlacklistEntry,
  AppealRequest,
  DbAdapter,
  DbRow,
  EventBusAdapter,
  BanScope,
  UserRole,
  AppealDecision,
} from '../types/blacklist.types';
import {
  UserBannedError,
  AppealAlreadyExistsError,
  NotBannedError,
  InsufficientPrivilegesError,
  BlacklistEntryNotFoundError,
  AppealNotFoundError,
} from '../types/blacklist.types';
import { withTenantContext } from '@tixly/rls-multitenancy';

// ---------------------------------------------------------------------------
// Kafka topic constants
// ---------------------------------------------------------------------------

const TOPIC_USER_BANNED = 'tixly.blacklist.user-banned';
const TOPIC_BAN_LIFTED = 'tixly.blacklist.ban-lifted';

// ---------------------------------------------------------------------------
// TenantContext
// ---------------------------------------------------------------------------

type TenantContext = {
  promoterId?: string;
  userId?: string;
  role: UserRole;
};

// ---------------------------------------------------------------------------
// DB row shapes
// ---------------------------------------------------------------------------

interface BlacklistEntryRow extends DbRow {
  id: string;
  user_id: string;
  email: string;
  promoter_id: string | null;
  scope: string;
  reason: string;
  status: string;
  banned_by: string;
  banned_at: string;
  lifted_at: string | null;
  lifted_by: string | null;
}

interface AppealRow extends DbRow {
  id: string;
  blacklist_entry_id: string;
  user_id: string;
  message: string;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  decision: string | null;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function mapEntry(row: BlacklistEntryRow): BlacklistEntry {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    promoterId: row.promoter_id,
    scope: row.scope as BanScope,
    reason: row.reason,
    status: row.status as BlacklistEntry['status'],
    bannedBy: row.banned_by,
    bannedAt: new Date(row.banned_at),
    liftedAt: row.lifted_at ? new Date(row.lifted_at) : null,
    liftedBy: row.lifted_by,
  };
}

function mapAppeal(row: AppealRow): AppealRequest {
  return {
    id: row.id,
    blacklistEntryId: row.blacklist_entry_id,
    userId: row.user_id,
    message: row.message,
    createdAt: new Date(row.created_at),
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
    reviewedBy: row.reviewed_by,
    decision: (row.decision as AppealDecision | null),
  };
}

// ---------------------------------------------------------------------------
// Service dependencies container
// ---------------------------------------------------------------------------

export interface BlacklistDeps {
  db: DbAdapter;
  eventBus: EventBusAdapter;
}

// ---------------------------------------------------------------------------
// banUser
// ---------------------------------------------------------------------------

export interface BanUserParams {
  userId: string;
  email: string;
  promoterId?: string;
  scope: BanScope;
  reason: string;
  bannedBy: string;
}

/**
 * Bans a user. Platform bans require 'admin' role.
 * Promoter bans require 'promoter' role and a matching promoterId.
 * Idempotent: if an active ban already exists for the same (userId, scope,
 * promoterId) combination, the existing entry is returned unchanged.
 */
export async function banUser(
  deps: BlacklistDeps,
  params: BanUserParams,
  role: UserRole,
): Promise<BlacklistEntry> {
  const { db, eventBus } = deps;
  const { userId, email, promoterId, scope, reason, bannedBy } = params;

  // Role guard
  if (scope === 'platform' && role !== 'admin') {
    throw new InsufficientPrivilegesError('Only admins can issue platform-wide bans.');
  }
  if (scope === 'promoter' && role !== 'admin' && role !== 'promoter') {
    throw new InsufficientPrivilegesError('Only admins or promoters can issue promoter bans.');
  }

  const context: TenantContext = { role, promoterId, userId: bannedBy };

  return withTenantContext(db, context, async (tx) => {
    // Upsert: insert or return existing active ban for the same key
    const rows = await tx.query<BlacklistEntryRow>(
      `INSERT INTO blacklist.blacklist_entries
         (user_id, email, promoter_id, scope, reason, status, banned_by, banned_at)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, NOW())
       ON CONFLICT (user_id, scope, COALESCE(promoter_id, ''))
         DO UPDATE SET
           reason    = EXCLUDED.reason,
           banned_by = EXCLUDED.banned_by,
           banned_at = NOW(),
           status    = 'active',
           lifted_at = NULL,
           lifted_by = NULL
       RETURNING *`,
      [userId, email, promoterId ?? null, scope, reason, bannedBy],
    );

    const entry = mapEntry(rows[0]!);

    await eventBus.publish(TOPIC_USER_BANNED, {
      entryId: entry.id,
      userId: entry.userId,
      email: entry.email,
      scope: entry.scope,
      promoterId: entry.promoterId,
      reason: entry.reason,
      bannedBy: entry.bannedBy,
      bannedAt: entry.bannedAt.toISOString(),
    });

    return entry;
  });
}

// ---------------------------------------------------------------------------
// liftBan
// ---------------------------------------------------------------------------

/**
 * Lifts an active ban. Platform bans can only be lifted by admins.
 * Promoter bans can be lifted by the promoter (own scope) or an admin.
 */
export async function liftBan(
  deps: BlacklistDeps,
  entryId: string,
  liftedBy: string,
  role: UserRole,
  callerPromoterId?: string,
): Promise<BlacklistEntry> {
  const { db, eventBus } = deps;

  if (role === 'promoter' && !callerPromoterId) {
    throw new InsufficientPrivilegesError('Promoter callers must provide promoter id.');
  }

  const context: TenantContext = {
    role,
    userId: liftedBy,
    promoterId: role === 'promoter' ? callerPromoterId : undefined,
  };

  return withTenantContext(db, context, async (tx) => {
    const rows = await tx.query<BlacklistEntryRow>(
      `SELECT * FROM blacklist.blacklist_entries WHERE id = $1`,
      [entryId],
    );

    if (rows.length === 0) {
      throw new BlacklistEntryNotFoundError(entryId);
    }

    const entry = rows[0]!;

    if (entry.status !== 'active' && entry.status !== 'appealing') {
      throw new NotBannedError(`Entry ${entryId} is already in status '${entry.status}'.`);
    }

    // Role guard: platform bans — admin only
    if (entry.scope === 'platform' && role !== 'admin') {
      throw new InsufficientPrivilegesError('Only admins can lift platform-wide bans.');
    }

    // Promoter can only lift bans belonging to their own tenant. Anti-enumeration:
    // treat cross-tenant as BlacklistEntryNotFoundError so callers cannot probe.
    if (role === 'promoter' && entry.promoter_id !== callerPromoterId) {
      throw new BlacklistEntryNotFoundError(entryId);
    }

    const updated = await tx.query<BlacklistEntryRow>(
      `UPDATE blacklist.blacklist_entries
       SET status = 'lifted', lifted_at = NOW(), lifted_by = $1
       WHERE id = $2 AND (promoter_id IS NOT DISTINCT FROM $3) -- tenant-scoped
       RETURNING *`,
      [liftedBy, entryId, entry.promoter_id],
    );

    const lifted = mapEntry(updated[0]!);

    await eventBus.publish(TOPIC_BAN_LIFTED, {
      entryId: lifted.id,
      userId: lifted.userId,
      scope: lifted.scope,
      promoterId: lifted.promoterId,
      liftedBy: lifted.liftedBy,
      liftedAt: lifted.liftedAt?.toISOString(),
    });

    return lifted;
  });
}

// ---------------------------------------------------------------------------
// checkBan
// ---------------------------------------------------------------------------

/**
 * Returns the most relevant active ban for a user, or null.
 * Platform ban takes precedence over promoter ban.
 * Anti-enumeration: always returns null (not an error) when not banned.
 */
export async function checkBan(
  deps: BlacklistDeps,
  userId: string,
  promoterId?: string,
): Promise<BlacklistEntry | null> {
  const { db } = deps;
  const context: TenantContext = { role: 'service' };

  return withTenantContext(db, context, async (tx) => {
    // Check platform ban first
    const platformRows = await tx.query<BlacklistEntryRow>(
      `SELECT * FROM blacklist.blacklist_entries
       WHERE user_id = $1 AND scope = 'platform' AND status IN ('active', 'appealing')
       ORDER BY banned_at DESC
       LIMIT 1`,
      [userId],
    );

    if (platformRows.length > 0) {
      return mapEntry(platformRows[0]!);
    }

    // Check promoter-scoped ban if promoterId provided
    if (promoterId) {
      const promoterRows = await tx.query<BlacklistEntryRow>(
        `SELECT * FROM blacklist.blacklist_entries
         WHERE user_id = $1 AND scope = 'promoter' AND promoter_id = $2
           AND status IN ('active', 'appealing')
         ORDER BY banned_at DESC
         LIMIT 1`,
        [userId, promoterId],
      );

      if (promoterRows.length > 0) {
        return mapEntry(promoterRows[0]!);
      }
    }

    return null;
  });
}

// ---------------------------------------------------------------------------
// submitAppeal
// ---------------------------------------------------------------------------

/**
 * The banned user submits an appeal. Only the owner of the ban can appeal.
 * ON CONFLICT (idempotent): if an appeal already exists for the same entry,
 * throws AppealAlreadyExistsError (caller can safely retry on network errors
 * by catching and ignoring this specific error).
 */
export async function submitAppeal(
  deps: BlacklistDeps,
  userId: string,
  entryId: string,
  message: string,
): Promise<AppealRequest> {
  const { db } = deps;
  const context: TenantContext = { role: 'buyer', userId };

  return withTenantContext(db, context, async (tx) => {
    // Verify the entry belongs to this user
    const entryRows = await tx.query<BlacklistEntryRow>(
      `SELECT * FROM blacklist.blacklist_entries WHERE id = $1 AND user_id = $2`,
      [entryId, userId],
    );

    if (entryRows.length === 0) {
      // Do not distinguish between "not found" and "not yours" — anti-enumeration
      throw new BlacklistEntryNotFoundError(entryId);
    }

    const entry = entryRows[0]!;

    if (entry.status !== 'active') {
      throw new NotBannedError(`Cannot appeal an entry with status '${entry.status}'.`);
    }

    // Try to insert; ON CONFLICT detects duplicate
    const appealRows = await tx.query<AppealRow & { conflict: boolean }>(
      `INSERT INTO blacklist.appeals
         (blacklist_entry_id, user_id, message, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (blacklist_entry_id) DO NOTHING
       RETURNING *`,
      [entryId, userId, message],
    );

    if (appealRows.length === 0) {
      // Row already exists — conflict fired
      throw new AppealAlreadyExistsError(entryId);
    }

    // Mark the ban entry as 'appealing' -- tenant-scoped
    await tx.query(
      `UPDATE blacklist.blacklist_entries SET status = 'appealing'
       WHERE id = $1 AND (promoter_id IS NOT DISTINCT FROM $2)`,
      [entryId, entry.promoter_id],
    );

    return mapAppeal(appealRows[0]!);
  });
}

// ---------------------------------------------------------------------------
// reviewAppeal
// ---------------------------------------------------------------------------

/**
 * Admin/promoter reviews an appeal.
 * If decision is 'approved' → liftBan is called automatically.
 * If decision is 'rejected' → ban status reverts to 'active'.
 */
export async function reviewAppeal(
  deps: BlacklistDeps,
  appealId: string,
  decision: AppealDecision,
  reviewedBy: string,
  role: UserRole,
  callerPromoterId?: string,
): Promise<AppealRequest> {
  const { db } = deps;

  if (role === 'promoter' && !callerPromoterId) {
    throw new InsufficientPrivilegesError('Promoter callers must provide promoter id.');
  }

  const context: TenantContext = {
    role,
    userId: reviewedBy,
    promoterId: role === 'promoter' ? callerPromoterId : undefined,
  };

  return withTenantContext(db, context, async (tx) => {
    // Join on blacklist_entries so we can read the parent entry's promoter_id
    // and enforce tenant scoping for promoter callers in a single round-trip.
    const appealRows = await tx.query<AppealRow & { entry_promoter_id: string | null }>(
      `SELECT a.*, e.promoter_id AS entry_promoter_id
         FROM blacklist.appeals a
         JOIN blacklist.blacklist_entries e ON e.id = a.blacklist_entry_id
        WHERE a.id = $1`,
      [appealId],
    );

    if (appealRows.length === 0) {
      throw new AppealNotFoundError(appealId);
    }

    const appeal = appealRows[0]!;

    // Promoter can only review appeals for bans in their own tenant.
    // Anti-enumeration: return AppealNotFoundError on cross-tenant access.
    if (role === 'promoter' && appeal.entry_promoter_id !== callerPromoterId) {
      throw new AppealNotFoundError(appealId);
    }

    if (appeal.decision !== null) {
      // Already reviewed — return current state (idempotent)
      return mapAppeal(appeal);
    }

    // Persist the review decision — scoped by appeal id (already tenant-validated above)
    const updated = await tx.query<AppealRow>(
      `UPDATE blacklist.appeals
       SET decision = $1, reviewed_by = $2, reviewed_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [decision, reviewedBy, appealId],
    );

    const reviewedAppeal = mapAppeal(updated[0]!);

    if (decision === 'approved') {
      // Auto-lift the ban — reuse deps (not the inner tx db) so liftBan can run its own context
      await liftBan(deps, appeal.blacklist_entry_id, reviewedBy, role, callerPromoterId);
    } else {
      // Rejected: revert ban status back to 'active' -- tenant-scoped via appeal join
      await tx.query(
        `UPDATE blacklist.blacklist_entries e
         SET status = 'active'
         FROM blacklist.appeals a
         WHERE e.id = a.blacklist_entry_id
           AND a.id = $1
           AND e.id = $2`,
        [appealId, appeal.blacklist_entry_id],
      );
    }

    return reviewedAppeal;
  });
}

// ---------------------------------------------------------------------------
// listBans
// ---------------------------------------------------------------------------

/**
 * Lists bans.
 * - Admins see all bans (optionally filtered by scope/promoterId).
 * - Promoters see only their own promoter-scoped bans.
 */
export async function listBans(
  deps: BlacklistDeps,
  role: UserRole,
  callerPromoterId?: string,
  filterPromoterId?: string,
  scope?: BanScope,
): Promise<BlacklistEntry[]> {
  const { db } = deps;
  const context: TenantContext = { role, promoterId: callerPromoterId };

  return withTenantContext(db, context, async (tx) => {
    const conditions: string[] = [];
    const params: unknown[] = [];

    // Promoters can only see their own bans
    if (role === 'promoter') {
      if (!callerPromoterId) {
        return [];
      }
      params.push(callerPromoterId);
      conditions.push(`promoter_id = $${params.length}`);
      conditions.push(`scope = 'promoter'`);
    } else {
      // Admin can filter by promoter or scope
      if (filterPromoterId) {
        params.push(filterPromoterId);
        conditions.push(`promoter_id = $${params.length}`);
      }
      if (scope) {
        params.push(scope);
        conditions.push(`scope = $${params.length}`);
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = await tx.query<BlacklistEntryRow>(
      `SELECT * FROM blacklist.blacklist_entries
       ${where}
       ORDER BY banned_at DESC`,
      params,
    );

    return rows.map(mapEntry);
  });
}

// ---------------------------------------------------------------------------
// listAppeals
// ---------------------------------------------------------------------------

/**
 * Lists appeals pending review (decision IS NULL).
 * - Admins see all pending appeals.
 * - Promoters see only appeals for their own bans.
 */
export async function listAppeals(
  deps: BlacklistDeps,
  role: UserRole,
  callerPromoterId?: string,
): Promise<AppealRequest[]> {
  const { db } = deps;
  const context: TenantContext = { role, promoterId: callerPromoterId };

  return withTenantContext(db, context, async (tx) => {
    if (role === 'promoter') {
      if (!callerPromoterId) return [];

      const rows = await tx.query<AppealRow>(
        `SELECT a.*
         FROM blacklist.appeals a
         JOIN blacklist.blacklist_entries e ON e.id = a.blacklist_entry_id
         WHERE a.decision IS NULL
           AND e.scope = 'promoter'
           AND e.promoter_id = $1
         ORDER BY a.created_at ASC`,
        [callerPromoterId],
      );
      return rows.map(mapAppeal);
    }

    // Admin: all pending appeals
    const rows = await tx.query<AppealRow>(
      `SELECT * FROM blacklist.appeals
       WHERE decision IS NULL
       ORDER BY created_at ASC`,
    );
    return rows.map(mapAppeal);
  });
}
