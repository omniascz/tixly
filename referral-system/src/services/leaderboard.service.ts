import type { LeaderboardEntry, DbAdapter } from '../types/referral.types';

// ============================================================
// Leaderboard Service
// ============================================================

interface LeaderboardRow {
  user_id: string;
  first_name: string;
  last_name: string;
  total_conversions: string;
  total_earned_halire: string;
}

interface RankRow {
  user_rank: string;
}

/**
 * Anonymise a full name as "Jan K." (first name + first letter of surname).
 */
function anonymiseName(firstName: string, lastName: string): string {
  const first = firstName.trim();
  const lastInitial = lastName.trim().charAt(0).toUpperCase();
  return `${first} ${lastInitial}.`;
}

/**
 * Return the top referrers for a given calendar month.
 *
 * Ranks by total_conversions DESC, then total_earned_halire DESC as tiebreaker.
 * Only confirmed conversions are counted (chargeback protection has elapsed).
 *
 * Assumes a `public.users` table with columns: id, first_name, last_name.
 */
export async function getMonthlyLeaderboard(
  year: number,
  month: number,
  limit: number,
  db: DbAdapter,
): Promise<LeaderboardEntry[]> {
  // Build the start/end of the requested month in UTC
  const monthStr = String(month).padStart(2, '0');
  const periodStart = `${year}-${monthStr}-01`;
  // First day of next month
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonthStr = String(nextMonth).padStart(2, '0');
  const periodEnd = `${nextYear}-${nextMonthStr}-01`;

  const rows = await db.query<LeaderboardRow>(
    `SELECT
       l.user_id,
       u.first_name,
       u.last_name,
       COUNT(c.id)::text                        AS total_conversions,
       COALESCE(SUM(c.earned_halire), 0)::text  AS total_earned_halire
     FROM referral.conversions c
     JOIN referral.links l ON l.id = c.link_id
     JOIN public.users u   ON u.id = l.user_id
     WHERE c.status IN ('confirmed', 'paid')
       AND c.confirmed_at >= $1
       AND c.confirmed_at <  $2
     GROUP BY l.user_id, u.first_name, u.last_name
     ORDER BY total_conversions DESC, total_earned_halire DESC
     LIMIT $3`,
    [periodStart, periodEnd, limit],
  );

  return rows.map((row, index) => ({
    rank: index + 1,
    userId: row.user_id,
    displayName: anonymiseName(row.first_name, row.last_name),
    totalConversions: parseInt(row.total_conversions, 10),
    totalEarnedHalire: parseInt(row.total_earned_halire, 10),
  }));
}

/**
 * Return the 1-based rank of a specific user in the monthly leaderboard,
 * or null if the user does not appear in the leaderboard for that month.
 */
export async function getUserRank(
  userId: string,
  year: number,
  month: number,
  db: DbAdapter,
): Promise<number | null> {
  const monthStr = String(month).padStart(2, '0');
  const periodStart = `${year}-${monthStr}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonthStr = String(nextMonth).padStart(2, '0');
  const periodEnd = `${nextYear}-${nextMonthStr}-01`;

  const row = await db.queryOne<RankRow>(
    `WITH ranked AS (
       SELECT
         l.user_id,
         RANK() OVER (
           ORDER BY COUNT(c.id) DESC, COALESCE(SUM(c.earned_halire), 0) DESC
         ) AS user_rank
       FROM referral.conversions c
       JOIN referral.links l ON l.id = c.link_id
       WHERE c.status IN ('confirmed', 'paid')
         AND c.confirmed_at >= $1
         AND c.confirmed_at <  $2
       GROUP BY l.user_id
     )
     SELECT user_rank::text FROM ranked WHERE user_id = $3`,
    [periodStart, periodEnd, userId],
  );

  return row ? parseInt(row.user_rank, 10) : null;
}
