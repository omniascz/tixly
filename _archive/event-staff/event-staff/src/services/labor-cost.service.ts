/**
 * Labor cost reporting — aggregates shift payouts across date ranges,
 * events, roles, and individual staff.
 *
 * Used by promoter dashboards to track payroll spending and plan budgets.
 */
import type { DbAdapter } from '../lib/service-container.js';

export interface LaborCostSummary {
  promoterId: string;
  from: string;
  to: string;
  totalHoursWorked: number;       // decimal hours
  totalPayoutHalire: number;
  shiftsCompleted: number;
  shiftsCancelled: number;
  avgHourlyRateHalire: number;
  byRole: Array<{ role: string; hours: number; payoutHalire: number }>;
  byStaff: Array<{ staffId: string; staffName: string; hours: number; payoutHalire: number; shiftCount: number }>;
  byEvent: Array<{ eventId: string; payoutHalire: number; shiftCount: number }>;
}

export interface ServiceDeps {
  db: DbAdapter;
}

export async function getLaborCostReport(
  promoterId: string,
  from: string,            // ISO
  to: string,
  deps: ServiceDeps,
): Promise<LaborCostSummary> {
  // 1. Totals
  const [totalsRow] = await deps.db.query<{
    total_hours: string | null; total_payout: string | null;
    shifts_completed: number; shifts_cancelled: number;
  }>(
    `SELECT
       COALESCE(SUM(EXTRACT(EPOCH FROM (actual_ends_at - actual_starts_at)) / 3600), 0) AS total_hours,
       COALESCE(SUM(payout_halire), 0) AS total_payout,
       COUNT(*) FILTER (WHERE status = 'completed')::int AS shifts_completed,
       COUNT(*) FILTER (WHERE status = 'cancelled')::int AS shifts_cancelled
     FROM platform.staff_shifts
     WHERE promoter_id = $1
       AND starts_at >= $2 AND starts_at < $3
       AND status IN ('completed', 'cancelled')`,
    [promoterId, from, to],
  );

  const totalHours = parseFloat(totalsRow?.total_hours ?? '0');
  const totalPayout = parseInt(totalsRow?.total_payout ?? '0', 10);
  const avgRate = totalHours > 0 ? Math.round(totalPayout / totalHours) : 0;

  // 2. Breakdown by role
  const roleRows = await deps.db.query<{ role: string; hours: string; payout: string }>(
    `SELECT role,
            COALESCE(SUM(EXTRACT(EPOCH FROM (actual_ends_at - actual_starts_at)) / 3600), 0) AS hours,
            COALESCE(SUM(payout_halire), 0) AS payout
     FROM platform.staff_shifts
     WHERE promoter_id = $1
       AND starts_at >= $2 AND starts_at < $3
       AND status = 'completed'
     GROUP BY role
     ORDER BY payout DESC`,
    [promoterId, from, to],
  );

  // 3. Breakdown by staff (top 20)
  const staffRows = await deps.db.query<{
    staff_id: string; first_name: string; last_name: string;
    hours: string; payout: string; shift_count: number;
  }>(
    `SELECT sh.staff_id,
            sm.first_name, sm.last_name,
            COALESCE(SUM(EXTRACT(EPOCH FROM (sh.actual_ends_at - sh.actual_starts_at)) / 3600), 0) AS hours,
            COALESCE(SUM(sh.payout_halire), 0) AS payout,
            COUNT(*)::int AS shift_count
     FROM platform.staff_shifts sh
     JOIN platform.staff_members sm ON sm.id = sh.staff_id
     WHERE sh.promoter_id = $1
       AND sh.starts_at >= $2 AND sh.starts_at < $3
       AND sh.status = 'completed'
     GROUP BY sh.staff_id, sm.first_name, sm.last_name
     ORDER BY payout DESC
     LIMIT 20`,
    [promoterId, from, to],
  );

  // 4. Breakdown by event
  const eventRows = await deps.db.query<{ event_id: string; payout: string; shift_count: number }>(
    `SELECT event_id,
            COALESCE(SUM(payout_halire), 0) AS payout,
            COUNT(*)::int AS shift_count
     FROM platform.staff_shifts
     WHERE promoter_id = $1
       AND starts_at >= $2 AND starts_at < $3
       AND status = 'completed'
     GROUP BY event_id
     ORDER BY payout DESC
     LIMIT 50`,
    [promoterId, from, to],
  );

  return {
    promoterId,
    from,
    to,
    totalHoursWorked: Math.round(totalHours * 100) / 100,
    totalPayoutHalire: totalPayout,
    shiftsCompleted: totalsRow?.shifts_completed ?? 0,
    shiftsCancelled: totalsRow?.shifts_cancelled ?? 0,
    avgHourlyRateHalire: avgRate,
    byRole: roleRows.map((r) => ({
      role: r.role,
      hours: Math.round(parseFloat(r.hours) * 100) / 100,
      payoutHalire: parseInt(r.payout, 10),
    })),
    byStaff: staffRows.map((r) => ({
      staffId: r.staff_id,
      staffName: `${r.first_name} ${r.last_name}`,
      hours: Math.round(parseFloat(r.hours) * 100) / 100,
      payoutHalire: parseInt(r.payout, 10),
      shiftCount: r.shift_count,
    })),
    byEvent: eventRows.map((r) => ({
      eventId: r.event_id,
      payoutHalire: parseInt(r.payout, 10),
      shiftCount: r.shift_count,
    })),
  };
}
