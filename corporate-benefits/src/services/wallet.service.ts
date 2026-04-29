/**
 * Wallet + ledger service — computes balance from transactions and
 * handles spending with category-level rules enforcement.
 *
 * Design notes:
 *   - We use a double-entry style ledger: each allocation creates a 'credit'
 *     entry, each spend creates a 'debit' entry.
 *   - Available balance per category is computed on demand from the ledger.
 *   - FIFO consumption by expiry date: spending draws from the allocation
 *     that expires soonest first.
 */
import { BenefitError, type BenefitCategory } from '../lib/benefit-errors.js';
import type { BenefitDB } from './employer.service.js';

export type TransactionType = 'credit' | 'debit' | 'refund' | 'expiration';

export interface Transaction {
  id: string;
  employeeId: string;
  allocationId: string | null;
  type: TransactionType;
  category: BenefitCategory | null;
  amountHellers: number;
  description: string;
  merchantId: string | null;
  createdAt: Date;
}

export interface WalletBalance {
  employeeId: string;
  totalHellers: number;
  byCategory: Record<string, number>;
  byAllocation: Array<{
    allocationId: string;
    programName: string;
    remainingHellers: number;
    expiresAt: Date;
  }>;
}

export interface SpendInput {
  employeeId: string;
  category: BenefitCategory;
  amountHellers: number;
  description: string;
  merchantId?: string;
}

// ---------------------------------------------------------------------------
// Balance computation
// ---------------------------------------------------------------------------

/**
 * Computes remaining balance per allocation (credit - debits) for an employee.
 * Only includes allocations that haven't expired.
 */
export async function getWalletBalance(employeeId: string, db: BenefitDB): Promise<WalletBalance> {
  // Verify employee exists
  const { rows: empRows } = await db.query<{ is_active: boolean }>(
    `SELECT is_active FROM benefits.employees WHERE id = $1`,
    [employeeId],
  );
  if (!empRows[0]) throw new BenefitError('EMPLOYEE_NOT_FOUND');

  // Compute per-allocation balance
  const { rows: allocRows } = await db.query<{
    allocation_id: string; program_name: string; allowed_categories: string[];
    allocated: number; debited: number; expires_at: Date;
  }>(
    `SELECT a.id AS allocation_id,
            p.name AS program_name,
            p.allowed_categories,
            a.allocated_hellers AS allocated,
            COALESCE(
              (SELECT SUM(t.amount_hellers)::int
               FROM benefits.transactions t
               WHERE t.allocation_id = a.id
                 AND t.type IN ('debit','expiration')),
              0
            ) AS debited,
            a.expires_at
     FROM benefits.allocations a
     JOIN benefits.programs p ON p.id = a.program_id
     WHERE a.employee_id = $1
       AND a.expires_at > NOW()
     ORDER BY a.expires_at ASC`,
    [employeeId],
  );

  let totalHellers = 0;
  const byCategory: Record<string, number> = {};
  const byAllocation: WalletBalance['byAllocation'] = [];

  for (const row of allocRows) {
    const remaining = row.allocated - row.debited;
    if (remaining <= 0) continue;

    totalHellers += remaining;
    byAllocation.push({
      allocationId: row.allocation_id,
      programName: row.program_name,
      remainingHellers: remaining,
      expiresAt: row.expires_at,
    });

    // Distribute across allowed categories (for display — actual enforcement
    // happens on spend, where we check allowed_categories)
    for (const cat of row.allowed_categories) {
      byCategory[cat] = (byCategory[cat] ?? 0) + remaining;
    }
  }

  return { employeeId, totalHellers, byCategory, byAllocation };
}

// ---------------------------------------------------------------------------
// Spending (FIFO by expiry)
// ---------------------------------------------------------------------------

/**
 * Spends `amountHellers` from the employee's wallet on a given category.
 * Consumes allocations in FIFO order (by expiry), creating one or more
 * debit transactions linked to each allocation used.
 *
 * Throws:
 *   - EMPLOYEE_INACTIVE if employee is inactive
 *   - CATEGORY_NOT_ALLOWED if no active allocation permits the category
 *   - INSUFFICIENT_BALANCE if balance across allowed allocations < amount
 */
export async function spend(input: SpendInput, db: BenefitDB): Promise<Transaction[]> {
  if (input.amountHellers <= 0) throw new BenefitError('INVALID_AMOUNT');

  // 1. Validate employee
  const { rows: empRows } = await db.query<{ is_active: boolean }>(
    `SELECT is_active FROM benefits.employees WHERE id = $1`,
    [input.employeeId],
  );
  if (!empRows[0]) throw new BenefitError('EMPLOYEE_NOT_FOUND');
  if (!empRows[0].is_active) throw new BenefitError('EMPLOYEE_INACTIVE');

  // 2. Find allocations that permit the category, ordered by expiry (FIFO)
  const { rows: eligible } = await db.query<{
    id: string; allocated: number; debited: number; expires_at: Date;
  }>(
    `SELECT a.id,
            a.allocated_hellers AS allocated,
            COALESCE(
              (SELECT SUM(t.amount_hellers)::int
               FROM benefits.transactions t
               WHERE t.allocation_id = a.id
                 AND t.type IN ('debit','expiration')),
              0
            ) AS debited,
            a.expires_at
     FROM benefits.allocations a
     JOIN benefits.programs p ON p.id = a.program_id
     WHERE a.employee_id = $1
       AND a.expires_at > NOW()
       AND $2 = ANY(p.allowed_categories)
     ORDER BY a.expires_at ASC`,
    [input.employeeId, input.category],
  );

  if (eligible.length === 0) throw new BenefitError('CATEGORY_NOT_ALLOWED');

  // 3. Compute total available across eligible allocations
  const available = eligible.reduce((sum, a) => sum + (a.allocated - a.debited), 0);
  if (available < input.amountHellers) throw new BenefitError('INSUFFICIENT_BALANCE');

  // 4. Consume FIFO — create debit transactions
  let remaining = input.amountHellers;
  const transactions: Transaction[] = [];

  for (const alloc of eligible) {
    if (remaining <= 0) break;
    const allocRemaining = alloc.allocated - alloc.debited;
    if (allocRemaining <= 0) continue;

    const chargeAmount = Math.min(allocRemaining, remaining);

    const { rows } = await db.query<Transaction>(
      `INSERT INTO benefits.transactions
         (employee_id, allocation_id, type, category, amount_hellers, description, merchant_id)
       VALUES ($1,$2,'debit',$3,$4,$5,$6)
       RETURNING id, employee_id AS "employeeId", allocation_id AS "allocationId",
                 type, category, amount_hellers AS "amountHellers",
                 description, merchant_id AS "merchantId", created_at AS "createdAt"`,
      [input.employeeId, alloc.id, input.category, chargeAmount,
       input.description, input.merchantId ?? null],
    );
    transactions.push(rows[0]);
    remaining -= chargeAmount;
  }

  return transactions;
}

/**
 * Refunds a previously-debited transaction.
 */
export async function refund(
  transactionId: string,
  reason: string,
  db: BenefitDB,
): Promise<Transaction> {
  const { rows: origRows } = await db.query<{
    employee_id: string; allocation_id: string | null; category: BenefitCategory | null;
    amount_hellers: number; type: TransactionType;
  }>(
    `SELECT employee_id, allocation_id, category, amount_hellers, type
     FROM benefits.transactions WHERE id = $1`,
    [transactionId],
  );
  if (!origRows[0]) throw new BenefitError('ALLOCATION_NOT_FOUND', 'Original transaction not found.');
  if (origRows[0].type !== 'debit') {
    throw new BenefitError('INVALID_AMOUNT', 'Only debit transactions can be refunded.');
  }

  const { rows } = await db.query<Transaction>(
    `INSERT INTO benefits.transactions
       (employee_id, allocation_id, type, category, amount_hellers, description)
     VALUES ($1,$2,'refund',$3,$4,$5)
     RETURNING id, employee_id AS "employeeId", allocation_id AS "allocationId",
               type, category, amount_hellers AS "amountHellers",
               description, merchant_id AS "merchantId", created_at AS "createdAt"`,
    [origRows[0].employee_id, origRows[0].allocation_id, origRows[0].category,
     -origRows[0].amount_hellers, `Refund: ${reason}`],
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Transaction history
// ---------------------------------------------------------------------------

export async function listTransactions(
  employeeId: string,
  fromDate: string | undefined,
  toDate: string | undefined,
  db: BenefitDB,
): Promise<Transaction[]> {
  const conds = ['employee_id = $1'];
  const params: unknown[] = [employeeId];
  if (fromDate) { params.push(fromDate); conds.push(`created_at >= $${params.length}`); }
  if (toDate) { params.push(toDate); conds.push(`created_at <= $${params.length}`); }

  const { rows } = await db.query<Transaction>(
    `SELECT id, employee_id AS "employeeId", allocation_id AS "allocationId",
            type, category, amount_hellers AS "amountHellers",
            description, merchant_id AS "merchantId", created_at AS "createdAt"
     FROM benefits.transactions
     WHERE ${conds.join(' AND ')}
     ORDER BY created_at DESC`,
    params,
  );
  return rows;
}
