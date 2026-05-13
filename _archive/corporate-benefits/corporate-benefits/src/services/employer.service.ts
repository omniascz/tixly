/**
 * Employer + employee management.
 *
 * An employer is a B2B customer that allocates benefits to its employees.
 * Each employer is isolated (multi-tenant) via employer_id scoping.
 */
import { BenefitError } from '../lib/benefit-errors.js';

export interface BenefitDB {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export type BillingPlan = 'starter' | 'growth' | 'enterprise';

export interface EmployerInput {
  name: string;
  ico: string;                // Czech company ID
  billingEmail: string;
  plan: BillingPlan;
  contactPhone?: string;
}

export interface Employer {
  id: string;
  name: string;
  ico: string;
  billingEmail: string;
  plan: BillingPlan;
  contactPhone: string | null;
  isActive: boolean;
  createdAt: Date;
  employeeCount?: number;
  totalAllocatedHellers?: number;
}

export interface EmployeeInput {
  employerId: string;
  email: string;
  name: string;
  externalId?: string;        // HR system ID
  department?: string;
}

export interface Employee {
  id: string;
  employerId: string;
  email: string;
  name: string;
  externalId: string | null;
  department: string | null;
  isActive: boolean;
  joinedAt: Date;
  leftAt: Date | null;
}

// ---------------------------------------------------------------------------
// Employer CRUD
// ---------------------------------------------------------------------------

export async function createEmployer(input: EmployerInput, db: BenefitDB): Promise<Employer> {
  const { rows } = await db.query<Employer>(
    `INSERT INTO benefits.employers (name, ico, billing_email, plan, contact_phone)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, name, ico, billing_email AS "billingEmail", plan,
               contact_phone AS "contactPhone", is_active AS "isActive", created_at AS "createdAt"`,
    [input.name, input.ico, input.billingEmail, input.plan, input.contactPhone ?? null],
  );
  return rows[0];
}

export async function getEmployer(id: string, db: BenefitDB): Promise<Employer> {
  const { rows } = await db.query<Employer>(
    `SELECT e.id, e.name, e.ico, e.billing_email AS "billingEmail", e.plan,
            e.contact_phone AS "contactPhone", e.is_active AS "isActive", e.created_at AS "createdAt",
            (SELECT COUNT(*)::int FROM benefits.employees emp
             WHERE emp.employer_id = e.id AND emp.is_active) AS "employeeCount",
            (SELECT COALESCE(SUM(a.allocated_hellers), 0)::int FROM benefits.allocations a
             JOIN benefits.programs p ON p.id = a.program_id
             WHERE p.employer_id = e.id) AS "totalAllocatedHellers"
     FROM benefits.employers e WHERE e.id = $1`,
    [id],
  );
  if (!rows[0]) throw new BenefitError('EMPLOYER_NOT_FOUND');
  return rows[0];
}

export async function listEmployers(db: BenefitDB): Promise<Employer[]> {
  const { rows } = await db.query<Employer>(
    `SELECT id, name, ico, billing_email AS "billingEmail", plan,
            contact_phone AS "contactPhone", is_active AS "isActive", created_at AS "createdAt"
     FROM benefits.employers WHERE is_active = true ORDER BY name`,
    [],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Employee CRUD
// ---------------------------------------------------------------------------

export async function addEmployee(input: EmployeeInput, db: BenefitDB): Promise<Employee> {
  try {
    const { rows } = await db.query<Employee>(
      `INSERT INTO benefits.employees (employer_id, email, name, external_id, department)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, employer_id AS "employerId", email, name,
                 external_id AS "externalId", department,
                 is_active AS "isActive", joined_at AS "joinedAt", left_at AS "leftAt"`,
      [input.employerId, input.email.toLowerCase(), input.name,
       input.externalId ?? null, input.department ?? null],
    );
    return rows[0];
  } catch (err: unknown) {
    // Translate unique constraint violation
    const e = err as { code?: string; constraint?: string };
    if (e?.code === '23505') throw new BenefitError('DUPLICATE_EMPLOYEE');
    throw err;
  }
}

export async function getEmployee(id: string, db: BenefitDB): Promise<Employee> {
  const { rows } = await db.query<Employee>(
    `SELECT id, employer_id AS "employerId", email, name,
            external_id AS "externalId", department,
            is_active AS "isActive", joined_at AS "joinedAt", left_at AS "leftAt"
     FROM benefits.employees WHERE id = $1`,
    [id],
  );
  if (!rows[0]) throw new BenefitError('EMPLOYEE_NOT_FOUND');
  return rows[0];
}

export async function listEmployees(
  employerId: string,
  activeOnly: boolean,
  db: BenefitDB,
): Promise<Employee[]> {
  const conds = ['employer_id = $1'];
  if (activeOnly) conds.push('is_active = true');
  const { rows } = await db.query<Employee>(
    `SELECT id, employer_id AS "employerId", email, name,
            external_id AS "externalId", department,
            is_active AS "isActive", joined_at AS "joinedAt", left_at AS "leftAt"
     FROM benefits.employees WHERE ${conds.join(' AND ')} ORDER BY name`,
    [employerId],
  );
  return rows;
}

export async function deactivateEmployee(id: string, db: BenefitDB): Promise<Employee> {
  const { rows } = await db.query<Employee>(
    `UPDATE benefits.employees SET is_active = false, left_at = NOW()
     WHERE id = $1
     RETURNING id, employer_id AS "employerId", email, name,
               external_id AS "externalId", department,
               is_active AS "isActive", joined_at AS "joinedAt", left_at AS "leftAt"`,
    [id],
  );
  if (!rows[0]) throw new BenefitError('EMPLOYEE_NOT_FOUND');
  return rows[0];
}
