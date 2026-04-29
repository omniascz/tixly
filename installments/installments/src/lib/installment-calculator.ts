// Pure calculation functions for installment payments.
// All amounts are in haléře (CZK cents, integers).
// No side effects, no I/O — safe to use in tests and server alike.

import type { InstallmentPlan, InstallmentPayment, InstallmentSchedule } from '../types/installment.types';

// ---------------------------------------------------------------------------
// calculateInstallmentAmounts
// ---------------------------------------------------------------------------

/**
 * Splits `totalAmount` (haléře) into `plan.num_installments` parts.
 *
 * Rules:
 * - The first installment is calculated from `first_installment_pct`.
 * - The remaining amount is divided equally among the remaining installments
 *   using integer floor division.
 * - Any rounding remainder (due to haléř arithmetic) is added to the LAST
 *   installment so that sum of all installments always equals `totalAmount`.
 *
 * Returns an array of length `num_installments` (index 0 = first payment).
 */
export function calculateInstallmentAmounts(
  totalAmount: number,
  plan: InstallmentPlan,
): number[] {
  const n = plan.num_installments;

  const firstAmount = calculateFirstInstallmentAmount(totalAmount, plan);
  const remaining = totalAmount - firstAmount;

  if (n === 2) {
    // Only one subsequent installment — it gets the entire remaining amount.
    return [firstAmount, remaining];
  }

  // n = 3 or 4: split remaining equally, remainder to last.
  const subsequentCount = n - 1;
  const baseSubsequent = Math.floor(remaining / subsequentCount);
  const remainder = remaining - baseSubsequent * subsequentCount;

  const amounts: number[] = [firstAmount];
  for (let i = 1; i < n - 1; i++) {
    amounts.push(baseSubsequent);
  }
  // Last installment absorbs the rounding difference.
  amounts.push(baseSubsequent + remainder);

  return amounts;
}

// ---------------------------------------------------------------------------
// calculateFirstInstallmentAmount
// ---------------------------------------------------------------------------

/**
 * Returns the first installment amount in haléře, floored to integer.
 * The caller is responsible for adding any floor-residual to the last payment
 * (handled in `calculateInstallmentAmounts`).
 */
export function calculateFirstInstallmentAmount(
  totalAmount: number,
  plan: InstallmentPlan,
): number {
  return Math.floor((totalAmount * plan.first_installment_pct) / 100);
}

// ---------------------------------------------------------------------------
// calculateDueDates
// ---------------------------------------------------------------------------

/**
 * Builds an array of due dates of length `plan.num_installments`.
 *
 * - Index 0 is `firstPaymentDate` (the day of purchase — already paid).
 * - Each subsequent date is advanced by one `interval` unit:
 *   - 'weekly'  → +7 calendar days
 *   - 'monthly' → +1 calendar month (same day-of-month, clamped by JS Date)
 */
export function calculateDueDates(
  firstPaymentDate: Date,
  plan: InstallmentPlan,
): Date[] {
  const dates: Date[] = [new Date(firstPaymentDate)];

  for (let i = 1; i < plan.num_installments; i++) {
    const prev = dates[i - 1];
    let next: Date;

    if (plan.interval === 'weekly') {
      next = new Date(prev);
      next.setDate(next.getDate() + 7);
    } else {
      // monthly: advance by one calendar month
      next = new Date(prev);
      next.setMonth(next.getMonth() + 1);
    }

    dates.push(next);
  }

  return dates;
}

// ---------------------------------------------------------------------------
// isPaymentOverdue
// ---------------------------------------------------------------------------

/**
 * Returns true when a payment is overdue:
 *   - due_date is in the past (strictly before `now`)
 *   - status is 'pending' or 'retrying' (not yet resolved)
 */
export function isPaymentOverdue(payment: InstallmentPayment, now: Date): boolean {
  if (payment.status !== 'pending' && payment.status !== 'retrying') {
    return false;
  }
  return payment.due_date < now;
}

// ---------------------------------------------------------------------------
// shouldCancelSchedule
// ---------------------------------------------------------------------------

/**
 * Returns true when the schedule should be cancelled — i.e. at least one
 * installment has exhausted all retry attempts (retry_count >= 3).
 */
export function shouldCancelSchedule(schedule: InstallmentSchedule): boolean {
  return schedule.installments.some((p) => p.retry_count >= 3);
}

// ---------------------------------------------------------------------------
// getNextPendingPayment
// ---------------------------------------------------------------------------

/**
 * Returns the next installment that is due and not yet paid, or null if none.
 *
 * "Next" means: lowest installment_number among those with status 'pending'
 * or 'retrying' whose due_date <= now.
 */
export function getNextPendingPayment(
  schedule: InstallmentSchedule,
  now: Date,
): InstallmentPayment | null {
  const overdue = schedule.installments.filter((p) => isPaymentOverdue(p, now));

  if (overdue.length === 0) {
    return null;
  }

  // Sort ascending by installment_number and return the earliest.
  overdue.sort((a, b) => a.installment_number - b.installment_number);
  return overdue[0] ?? null;
}
