/**
 * segmentation.service.ts
 *
 * Core business logic for managing audience segments.
 * All functions receive a `deps` object (dependency injection) to keep
 * the service testable without a real database connection.
 *
 * Tenant isolation: every query filters by promoter_id. The
 * withTenantContext stub below mirrors the pattern used across Tixly.
 */

import { buildWhereClause } from "../lib/filter-builder";
import {
  Segment,
  SegmentFilter,
  SegmentMember,
  SegmentNotFoundError,
} from "../types/segmentation.types";
import { withTenantContext } from "@tixly/rls-multitenancy";
import type { DbAdapter } from "@tixly/rls-multitenancy";

export interface ServiceDeps {
  db: DbAdapter;
}

// ─── DB row shapes ────────────────────────────────────────────────────────────

interface SegmentRow {
  id: string;
  promoter_id: string;
  name: string;
  filter: unknown; // JSONB, parsed by the DB driver
  estimated_size: number;
  created_at: string;
  last_refreshed_at: string;
}

interface MemberRow {
  user_id: string;
  email: string;
  first_name: string | null;
}

interface CountRow {
  count: string; // PostgreSQL returns COUNT as text
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rowToSegment(row: SegmentRow): Segment {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    name: row.name,
    filter: row.filter as SegmentFilter,
    estimatedSize: row.estimated_size,
    createdAt: row.created_at,
    lastRefreshedAt: row.last_refreshed_at,
  };
}

/**
 * Executes the member-matching query and returns the COUNT of matching users.
 * This is called both at creation time and during refresh.
 */
async function computeEstimatedSize(
  db: DbAdapter,
  promoterId: string,
  filter: SegmentFilter,
): Promise<number> {
  const { sql: filterSql, params: filterParams } = buildWhereClause(filter);

  // promoter_id occupies $1; shift all filter param references by +1
  const shiftedFilterSql = filterSql.replace(/\$(\d+)/g, (_m, n: string) => {
    return `$${parseInt(n, 10) + 1}`;
  });

  const sql = `
    SELECT COUNT(*)::text AS count
    FROM identity.users u
    LEFT JOIN loyalty.accounts la ON la.user_id = u.id
    WHERE u.promoter_id = $1
      AND (${shiftedFilterSql})
  `;

  const rows = await db.query<CountRow>(sql, [promoterId, ...filterParams]);
  const first = rows[0];
  if (first === undefined) return 0;
  return parseInt(first.count, 10);
}

// ─── Service functions ────────────────────────────────────────────────────────

/**
 * Creates a new segment for the given promoter.
 * Immediately runs estimation so estimatedSize is populated on first read.
 */
export async function createSegment(
  deps: ServiceDeps,
  promoterId: string,
  name: string,
  filter: SegmentFilter,
): Promise<Segment> {
  return withTenantContext(deps.db, promoterId, async () => {
    const estimatedSize = await computeEstimatedSize(
      deps.db,
      promoterId,
      filter,
    );

    const rows = await deps.db.query<SegmentRow>(
      `INSERT INTO segmentation.segments
         (promoter_id, name, filter, estimated_size, created_at, last_refreshed_at)
       VALUES ($1, $2, $3::jsonb, $4, NOW(), NOW())
       RETURNING
         id, promoter_id, name, filter, estimated_size, created_at, last_refreshed_at`,
      [promoterId, name, JSON.stringify(filter), estimatedSize],
    );

    const row = rows[0];
    if (row === undefined) {
      throw new Error("INSERT INTO segmentation.segments returned no row");
    }

    return rowToSegment(row);
  });
}

/**
 * Re-computes estimatedSize for an existing segment and persists the result.
 * Throws SegmentNotFoundError if the segment does not exist or belongs to a
 * different promoter.
 */
export async function refreshSegment(
  deps: ServiceDeps,
  segmentId: string,
  promoterId: string,
): Promise<Segment> {
  return withTenantContext(deps.db, promoterId, async () => {
    const existing = await deps.db.queryOne<SegmentRow>(
      `SELECT id, promoter_id, name, filter, estimated_size, created_at, last_refreshed_at
       FROM segmentation.segments
       WHERE id = $1 AND promoter_id = $2`,
      [segmentId, promoterId],
    );

    if (existing === null) {
      throw new SegmentNotFoundError(segmentId);
    }

    const filter = existing.filter as SegmentFilter;
    const estimatedSize = await computeEstimatedSize(
      deps.db,
      promoterId,
      filter,
    );

    const rows = await deps.db.query<SegmentRow>(
      `UPDATE segmentation.segments
       SET estimated_size = $1, last_refreshed_at = NOW()
       WHERE id = $2 AND promoter_id = $3
       RETURNING
         id, promoter_id, name, filter, estimated_size, created_at, last_refreshed_at`,
      [estimatedSize, segmentId, promoterId],
    );

    const row = rows[0];
    if (row === undefined) {
      throw new SegmentNotFoundError(segmentId);
    }

    return rowToSegment(row);
  });
}

/**
 * Returns a paginated list of members matching the segment's filter.
 * Maximum page size is 1000 rows.
 */
export async function getMembers(
  deps: ServiceDeps,
  segmentId: string,
  promoterId: string,
  limit = 100,
  offset = 0,
): Promise<SegmentMember[]> {
  return withTenantContext(deps.db, promoterId, async () => {
    const clampedLimit = Math.min(limit, 1000);

    const segmentRow = await deps.db.queryOne<SegmentRow>(
      `SELECT id, filter
       FROM segmentation.segments
       WHERE id = $1 AND promoter_id = $2`,
      [segmentId, promoterId],
    );

    if (segmentRow === null) {
      throw new SegmentNotFoundError(segmentId);
    }

    const filter = segmentRow.filter as SegmentFilter;
    const { sql: filterSql, params: filterParams } = buildWhereClause(filter);

    // Final params array layout:
    //   $1              = promoterId
    //   $2 … $(N+1)    = filterParams  (N = filterParams.length)
    //   $(N+2)          = clampedLimit
    //   $(N+3)          = offset
    //
    // buildWhereClause returns SQL with $1..$N relative to filterParams.
    // We shift all $N in filterSql by +1 so they align with the final params array.
    const shiftedFilterSql = filterSql.replace(/\$(\d+)/g, (_m, n: string) => {
      return `$${parseInt(n, 10) + 1}`;
    });

    const sql = `
      SELECT u.id AS user_id, u.email, u.first_name
      FROM identity.users u
      LEFT JOIN loyalty.accounts la ON la.user_id = u.id
      WHERE u.promoter_id = $1
        AND (${shiftedFilterSql})
      ORDER BY u.email
      LIMIT $${filterParams.length + 2} OFFSET $${filterParams.length + 3}
    `;

    const rows = await deps.db.query<MemberRow>(sql, [
      promoterId,
      ...filterParams,
      clampedLimit,
      offset,
    ]);

    return rows.map((r) => ({
      userId: r.user_id,
      email: r.email,
      firstName: r.first_name,
    }));
  });
}

/**
 * Returns all email addresses in the segment for use in campaign export.
 * Hard-capped at 50 000 rows. Callers should check the returned array length
 * and warn users when the cap is reached.
 */
export async function exportSegment(
  deps: ServiceDeps,
  segmentId: string,
  promoterId: string,
): Promise<string[]> {
  return withTenantContext(deps.db, promoterId, async () => {
    const segmentRow = await deps.db.queryOne<SegmentRow>(
      `SELECT id, filter
       FROM segmentation.segments
       WHERE id = $1 AND promoter_id = $2`,
      [segmentId, promoterId],
    );

    if (segmentRow === null) {
      throw new SegmentNotFoundError(segmentId);
    }

    const filter = segmentRow.filter as SegmentFilter;
    const { sql: filterSql, params: filterParams } = buildWhereClause(filter);

    // promoter_id occupies $1; shift all filter param references by +1
    const shiftedFilterSql = filterSql.replace(/\$(\d+)/g, (_m, n: string) => {
      return `$${parseInt(n, 10) + 1}`;
    });

    const EXPORT_LIMIT = 50_000;

    const sql = `
      SELECT u.email
      FROM identity.users u
      LEFT JOIN loyalty.accounts la ON la.user_id = u.id
      WHERE u.promoter_id = $1
        AND (${shiftedFilterSql})
      ORDER BY u.email
      LIMIT $${filterParams.length + 2}
    `;

    const rows = await deps.db.query<{ email: string }>(sql, [
      promoterId,
      ...filterParams,
      EXPORT_LIMIT,
    ]);

    return rows.map((r) => r.email);
  });
}

/**
 * Lists all segments belonging to a promoter, ordered by creation date desc.
 */
export async function listSegments(
  deps: ServiceDeps,
  promoterId: string,
): Promise<Segment[]> {
  return withTenantContext(deps.db, promoterId, async () => {
    const rows = await deps.db.query<SegmentRow>(
      `SELECT id, promoter_id, name, filter, estimated_size, created_at, last_refreshed_at
       FROM segmentation.segments
       WHERE promoter_id = $1
       ORDER BY created_at DESC`,
      [promoterId],
    );

    return rows.map(rowToSegment);
  });
}

/**
 * Deletes a segment. Throws SegmentNotFoundError if the segment does not exist
 * or belongs to a different promoter (prevents cross-tenant deletion).
 */
export async function deleteSegment(
  deps: ServiceDeps,
  segmentId: string,
  promoterId: string,
): Promise<void> {
  return withTenantContext(deps.db, promoterId, async () => {
    const result = await deps.db.execute(
      `DELETE FROM segmentation.segments
       WHERE id = $1 AND promoter_id = $2`,
      [segmentId, promoterId],
    );

    if (result.rowsAffected === 0) {
      throw new SegmentNotFoundError(segmentId);
    }
  });
}
