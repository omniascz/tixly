/**
 * feature-extractor.ts — Queries the database and computes the five raw
 * churn features for a given season pass.
 *
 * All database access goes through the DbAdapter interface so this module
 * can be tested with an in-memory stub without touching Postgres.
 */

import type { DbAdapter, RawChurnFeatures } from "../types/churn.types";
import { PassNotFoundError } from "../types/churn.types";

// ─── DB row shapes (internal) ─────────────────────────────────────────────────

interface SeasonPassRow {
  id: string;
  user_id: string;
  organizer_id: string;
  pass_type: "season" | "flex";
  status: string;
  expires_at: string;
  total_uses: number | null;
  remaining_uses: number | null;
  renewed_from_pass_id: string | null;
  created_at: string;
}

interface PassUsageRow {
  used_at: string;
}

interface CohortRow {
  total: string;
  renewed: string;
}

// ─── Linear regression helper ─────────────────────────────────────────────────

/**
 * Computes the slope of a simple linear regression (least squares) over the
 * provided y-values, where x = 0, 1, 2, … (ordinal positions).
 *
 * Returns 0 when fewer than 2 points are provided (undefined slope).
 */
function linearRegressionSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;

  // x values are 0, 1, 2, … n-1
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((s, v) => s + v, 0) / n;

  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i++) {
    const dx = i - xMean;
    numerator += dx * ((values[i] ?? 0) - yMean);
    denominator += dx * dx;
  }

  if (denominator === 0) return 0;
  return numerator / denominator;
}

// ─── Public helpers ───────────────────────────────────────────────────────────

/**
 * Calculates the usage gap trend (slope in days per visit) from an ordered
 * list of usage dates.
 *
 * - Fewer than 3 visits → returns 0 (insufficient data; no trend)
 * - Takes the last min(5, n-1) inter-visit intervals
 * - Fits a simple linear regression over those intervals
 * - Positive slope = gaps are widening = churn signal
 */
export function calculateUsageGapTrend(usageDates: Date[]): number {
  if (usageDates.length < 3) return 0;

  // Sort ascending (should already be sorted by DB ORDER BY, but be defensive)
  const sorted = [...usageDates].sort((a, b) => a.getTime() - b.getTime());

  // Compute consecutive intervals in days
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (prev !== undefined && curr !== undefined) {
      const diffMs = curr.getTime() - prev.getTime();
      intervals.push(diffMs / (1000 * 60 * 60 * 24));
    }
  }

  // Take the last up to 5 intervals
  const recentIntervals = intervals.slice(-5);

  return linearRegressionSlope(recentIntervals);
}

/**
 * Queries the historical renewal rate for a given organiser + pass type
 * cohort.
 *
 * Cohort key: `${organizerId}:${passType}`
 *
 * A pass is considered "renewed" if its status is 'active' OR
 * renewed_from_pass_id IS NOT NULL (i.e. it replaced a previous pass).
 *
 * Returns the conservative default 0.65 when fewer than 10 samples exist.
 */
export async function getCohortRenewalRate(
  organizerId: string,
  passType: string,
  db: DbAdapter,
): Promise<number> {
  const MIN_SAMPLE_SIZE = 10;
  const DEFAULT_RATE = 0.65;

  const rows = await db.query<CohortRow>(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (
         WHERE status = 'active' OR renewed_from_pass_id IS NOT NULL
       ) AS renewed
     FROM passes.season_passes
     WHERE organizer_id = $1
       AND pass_type = $2`,
    [organizerId, passType],
  );

  const row = rows[0];
  if (row === undefined) return DEFAULT_RATE;

  const total = parseInt(row.total, 10);
  if (total < MIN_SAMPLE_SIZE) return DEFAULT_RATE;

  const renewed = parseInt(row.renewed, 10);
  return renewed / total;
}

// ─── Main extractor ───────────────────────────────────────────────────────────

/**
 * Extracts raw churn features for a season pass identified by passId.
 *
 * Feature computation:
 *
 * usage_rate:
 *   • flex pass  → (total_uses - remaining_uses) / total_uses
 *   • season pass → actual_usages / expected_usages_at_this_point
 *     where expected = (days_elapsed / total_days) × estimated_monthly_rate × months_total
 *     We use 2.0 visits/month as the estimated typical monthly usage rate.
 *     If expected is 0 (e.g. pass just started) usage_rate is clamped to 0.
 *
 * days_since_last_usage:
 *   • NOW() - MAX(used_at) in days.
 *   • If no usage recorded yet → days since pass was created.
 *
 * usage_gap_trend:
 *   • calculateUsageGapTrend() applied to the full sorted usage history.
 *
 * cohort_renewal_rate:
 *   • getCohortRenewalRate(organizerId, passType, db)
 *
 * months_as_subscriber:
 *   • (NOW() - created_at) in months (floor).
 *
 * @throws PassNotFoundError when passId does not exist.
 */
export async function extractPassFeatures(
  passId: string,
  db: DbAdapter,
): Promise<RawChurnFeatures> {
  // ── 1. Load pass details ─────────────────────────────────────────────────
  const pass = await db.queryOne<SeasonPassRow>(
    `SELECT id, user_id, organizer_id, pass_type, status, expires_at,
            total_uses, remaining_uses, renewed_from_pass_id, created_at
     FROM passes.season_passes
     WHERE id = $1`,
    [passId],
  );

  if (pass === null) {
    throw new PassNotFoundError(passId);
  }

  // ── 2. Load usage history ────────────────────────────────────────────────
  const usageRows = await db.query<PassUsageRow>(
    `SELECT used_at
     FROM passes.pass_usages
     WHERE pass_id = $1
     ORDER BY used_at ASC`,
    [passId],
  );

  const usageDates = usageRows.map((r) => new Date(r.used_at));

  // ── 3. usage_rate ────────────────────────────────────────────────────────
  const now = new Date();
  const createdAt = new Date(pass.created_at);
  const expiresAt = new Date(pass.expires_at);

  let usage_rate: number;

  if (pass.pass_type === "flex") {
    const totalUses = pass.total_uses ?? 0;
    const remainingUses = pass.remaining_uses ?? 0;
    usage_rate = totalUses > 0 ? (totalUses - remainingUses) / totalUses : 0;
  } else {
    // season pass — time-proportional expected usage
    const TYPICAL_VISITS_PER_MONTH = 2.0;
    const totalMs = expiresAt.getTime() - createdAt.getTime();
    const elapsedMs = now.getTime() - createdAt.getTime();
    const daysElapsed = elapsedMs / (1000 * 60 * 60 * 24);
    const totalDays = totalMs / (1000 * 60 * 60 * 24);
    const totalMonths = totalDays / 30;

    const expectedAtThisPoint =
      totalDays > 0
        ? (daysElapsed / totalDays) * TYPICAL_VISITS_PER_MONTH * totalMonths
        : 0;

    const actualUsages = usageDates.length;
    usage_rate =
      expectedAtThisPoint > 0 ? actualUsages / expectedAtThisPoint : 0;
  }

  // Clamp: overachievers get capped at 1
  usage_rate = Math.min(1, Math.max(0, usage_rate));

  // ── 4. days_since_last_usage ─────────────────────────────────────────────
  let days_since_last_usage: number;

  if (usageDates.length > 0) {
    const lastUsage = usageDates[usageDates.length - 1];
    const diffMs = lastUsage !== undefined
      ? now.getTime() - lastUsage.getTime()
      : now.getTime() - createdAt.getTime();
    days_since_last_usage = diffMs / (1000 * 60 * 60 * 24);
  } else {
    // No usage at all — use time since pass creation as proxy
    const diffMs = now.getTime() - createdAt.getTime();
    days_since_last_usage = diffMs / (1000 * 60 * 60 * 24);
  }

  // ── 5. usage_gap_trend ───────────────────────────────────────────────────
  const usage_gap_trend = calculateUsageGapTrend(usageDates);

  // ── 6. cohort_renewal_rate ───────────────────────────────────────────────
  const cohort_renewal_rate = await getCohortRenewalRate(
    pass.organizer_id,
    pass.pass_type,
    db,
  );

  // ── 7. months_as_subscriber ──────────────────────────────────────────────
  const monthsMs = now.getTime() - createdAt.getTime();
  const months_as_subscriber = Math.floor(
    monthsMs / (1000 * 60 * 60 * 24 * 30),
  );

  return {
    usage_rate,
    days_since_last_usage,
    usage_gap_trend,
    cohort_renewal_rate,
    months_as_subscriber,
  };
}
