/**
 * Employer reporting — usage stats, spending breakdown, utilization.
 */
import { BenefitError } from '../lib/benefit-errors.js';
import type { BenefitDB } from './employer.service.js';

export interface EmployerReport {
  employerId: string;
  month: string;
  totalEmployees: number;
  activeEmployees: number;
  totalAllocatedHellers: number;
  totalSpentHellers: number;
  utilizationPercent: number;
  spendByCategory: Record<string, number>;
  topSpenders: Array<{ employeeId: string; employeeName: string; spentHellers: number }>;
}

export async function getEmployerReport(
  employerId: string,
  month: string,          // YYYY-MM
  db: BenefitDB,
): Promise<EmployerReport> {
  // Verify employer
  const { rows: emp } = await db.query<{ id: string }>(
    `SELECT id FROM benefits.employers WHERE id = $1`,
    [employerId],
  );
  if (!emp[0]) throw new BenefitError('EMPLOYER_NOT_FOUND');

  // 1. Employee counts
  const { rows: empCounts } = await db.query<{ total: number; active: number }>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE is_active)::int AS active
     FROM benefits.employees WHERE employer_id = $1`,
    [employerId],
  );

  // 2. Total allocated this month
  const { rows: allocRows } = await db.query<{ total: number }>(
    `SELECT COALESCE(SUM(a.allocated_hellers), 0)::int AS total
     FROM benefits.allocations a
     JOIN benefits.programs p ON p.id = a.program_id
     WHERE p.employer_id = $1 AND a.month = $2`,
    [employerId, month],
  );

  // 3. Total spent this month (from transactions on allocations of this month)
  const { rows: spentRows } = await db.query<{ total: number }>(
    `SELECT COALESCE(SUM(t.amount_hellers), 0)::int AS total
     FROM benefits.transactions t
     JOIN benefits.allocations a ON a.id = t.allocation_id
     JOIN benefits.programs p ON p.id = a.program_id
     WHERE p.employer_id = $1 AND a.month = $2 AND t.type = 'debit'`,
    [employerId, month],
  );

  // 4. Spend breakdown by category
  const { rows: catRows } = await db.query<{ category: string; total: number }>(
    `SELECT t.category, SUM(t.amount_hellers)::int AS total
     FROM benefits.transactions t
     JOIN benefits.allocations a ON a.id = t.allocation_id
     JOIN benefits.programs p ON p.id = a.program_id
     WHERE p.employer_id = $1 AND a.month = $2 AND t.type = 'debit'
     GROUP BY t.category`,
    [employerId, month],
  );

  // 5. Top 10 spenders
  const { rows: topRows } = await db.query<{ employee_id: string; employee_name: string; spent: number }>(
    `SELECT t.employee_id, e.name AS employee_name, SUM(t.amount_hellers)::int AS spent
     FROM benefits.transactions t
     JOIN benefits.allocations a ON a.id = t.allocation_id
     JOIN benefits.programs p ON p.id = a.program_id
     JOIN benefits.employees e ON e.id = t.employee_id
     WHERE p.employer_id = $1 AND a.month = $2 AND t.type = 'debit'
     GROUP BY t.employee_id, e.name
     ORDER BY spent DESC
     LIMIT 10`,
    [employerId, month],
  );

  const totalAllocated = allocRows[0]?.total ?? 0;
  const totalSpent = spentRows[0]?.total ?? 0;
  const utilization = totalAllocated > 0
    ? Math.round((totalSpent / totalAllocated) * 100)
    : 0;

  const spendByCategory: Record<string, number> = {};
  for (const c of catRows) spendByCategory[c.category] = c.total;

  return {
    employerId,
    month,
    totalEmployees: empCounts[0]?.total ?? 0,
    activeEmployees: empCounts[0]?.active ?? 0,
    totalAllocatedHellers: totalAllocated,
    totalSpentHellers: totalSpent,
    utilizationPercent: utilization,
    spendByCategory,
    topSpenders: topRows.map((r) => ({
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      spentHellers: r.spent,
    })),
  };
}
