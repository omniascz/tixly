/**
 * Benefit program + allocation management.
 *
 * A program defines a named monthly credit amount + allowed categories.
 * Allocations are monthly deposits to employee accounts created by the program.
 */
import { BenefitError, isValidCategory, type BenefitCategory } from '../lib/benefit-errors.js';
import type { BenefitDB } from './employer.service.js';

export interface ProgramInput {
  employerId: string;
  name: string;
  monthlyCreditHellers: number;
  allowedCategories: string[];
  rolloverMonths?: number;    // how long unused credits roll over (default 0 = expire end of month)
}

export interface BenefitProgram {
  id: string;
  employerId: string;
  name: string;
  monthlyCreditHellers: number;
  allowedCategories: BenefitCategory[];
  rolloverMonths: number;
  isActive: boolean;
}

export interface Allocation {
  id: string;
  programId: string;
  employeeId: string;
  month: string;              // YYYY-MM
  allocatedHellers: number;
  expiresAt: Date;
  programName?: string;
  allowedCategories?: BenefitCategory[];
}

// ---------------------------------------------------------------------------
// Program CRUD
// ---------------------------------------------------------------------------

export async function createProgram(input: ProgramInput, db: BenefitDB): Promise<BenefitProgram> {
  if (input.monthlyCreditHellers < 0) throw new BenefitError('INVALID_AMOUNT');
  for (const c of input.allowedCategories) {
    if (!isValidCategory(c)) throw new BenefitError('CATEGORY_NOT_ALLOWED', `Unknown category: ${c}`);
  }

  const { rows } = await db.query<BenefitProgram>(
    `INSERT INTO benefits.programs
       (employer_id, name, monthly_credit_hellers, allowed_categories, rollover_months)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, employer_id AS "employerId", name,
               monthly_credit_hellers AS "monthlyCreditHellers",
               allowed_categories AS "allowedCategories",
               rollover_months AS "rolloverMonths", is_active AS "isActive"`,
    [input.employerId, input.name, input.monthlyCreditHellers,
     input.allowedCategories, input.rolloverMonths ?? 0],
  );
  return rows[0];
}

export async function getProgram(id: string, db: BenefitDB): Promise<BenefitProgram> {
  const { rows } = await db.query<BenefitProgram>(
    `SELECT id, employer_id AS "employerId", name,
            monthly_credit_hellers AS "monthlyCreditHellers",
            allowed_categories AS "allowedCategories",
            rollover_months AS "rolloverMonths", is_active AS "isActive"
     FROM benefits.programs WHERE id = $1`,
    [id],
  );
  if (!rows[0]) throw new BenefitError('PROGRAM_NOT_FOUND');
  return rows[0];
}

export async function listPrograms(employerId: string, db: BenefitDB): Promise<BenefitProgram[]> {
  const { rows } = await db.query<BenefitProgram>(
    `SELECT id, employer_id AS "employerId", name,
            monthly_credit_hellers AS "monthlyCreditHellers",
            allowed_categories AS "allowedCategories",
            rollover_months AS "rolloverMonths", is_active AS "isActive"
     FROM benefits.programs WHERE employer_id = $1 AND is_active = true ORDER BY name`,
    [employerId],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Monthly allocation
// ---------------------------------------------------------------------------

/**
 * Allocates monthly credits to all active employees of the employer for the
 * given program. Idempotent: won't double-allocate for the same month.
 *
 * Called by cron on the 1st of each month.
 */
export async function allocateMonthly(
  programId: string,
  month: string,               // YYYY-MM
  db: BenefitDB,
): Promise<{ allocated: number; skipped: number; totalHellers: number }> {
  const program = await getProgram(programId, db);
  if (!program.isActive) throw new BenefitError('PROGRAM_NOT_FOUND', 'Program is inactive.');

  // Calculate expiry: end of (month + rolloverMonths)
  const [y, m] = month.split('-').map(Number);
  const expiryMonth = new Date(Date.UTC(y, m + program.rolloverMonths, 0, 23, 59, 59));

  // Find active employees without existing allocation for this month
  const { rows: employees } = await db.query<{ id: string }>(
    `SELECT e.id
     FROM benefits.employees e
     WHERE e.employer_id = $1 AND e.is_active = true
       AND NOT EXISTS (
         SELECT 1 FROM benefits.allocations a
         WHERE a.program_id = $2 AND a.employee_id = e.id AND a.month = $3
       )`,
    [program.employerId, programId, month],
  );

  let allocated = 0;
  for (const emp of employees) {
    await db.execute(
      `INSERT INTO benefits.allocations (program_id, employee_id, month, allocated_hellers, expires_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (program_id, employee_id, month) DO NOTHING`,
      [programId, emp.id, month, program.monthlyCreditHellers, expiryMonth.toISOString()],
    );
    allocated++;
  }

  // Count how many active employees already had allocation (skipped)
  const { rows: totalRows } = await db.query<{ cnt: number }>(
    `SELECT COUNT(*)::int AS cnt FROM benefits.employees
     WHERE employer_id = $1 AND is_active = true`,
    [program.employerId],
  );
  const totalActive = totalRows[0]?.cnt ?? 0;
  const skipped = totalActive - allocated;

  return {
    allocated,
    skipped,
    totalHellers: allocated * program.monthlyCreditHellers,
  };
}

export async function listAllocations(
  employeeId: string,
  db: BenefitDB,
): Promise<Allocation[]> {
  const { rows } = await db.query<Allocation>(
    `SELECT a.id, a.program_id AS "programId", a.employee_id AS "employeeId",
            a.month, a.allocated_hellers AS "allocatedHellers",
            a.expires_at AS "expiresAt",
            p.name AS "programName",
            p.allowed_categories AS "allowedCategories"
     FROM benefits.allocations a
     JOIN benefits.programs p ON p.id = a.program_id
     WHERE a.employee_id = $1
       AND a.expires_at > NOW()
     ORDER BY a.month DESC`,
    [employeeId],
  );
  return rows;
}
