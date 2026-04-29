// Installment payment service.
// Depends on adapter interfaces (InstallmentDbAdapter, GoPayAdapter) injected
// at call sites — no concrete DB or HTTP client imported here.

import {
  InstallmentNotSupportedError,
  InstallmentScheduleNotFoundError,
  InstallmentAlreadyActiveError,
} from '../types/installment.types';
import type { InstallmentSchedule, InstallmentPayment } from '../types/installment.types';
import {
  calculateInstallmentAmounts,
  calculateDueDates,
  shouldCancelSchedule,
  getNextPendingPayment,
} from '../lib/installment-calculator';

// ---------------------------------------------------------------------------
// Adapter interfaces
// ---------------------------------------------------------------------------

export interface InstallmentDbAdapter {
  findInstallmentPlan(ticketTypeId: string): Promise<InstallmentPlan | null>;
  findScheduleByOrder(orderId: string): Promise<InstallmentSchedule | null>;
  findScheduleById(id: string): Promise<InstallmentSchedule | null>;
  createSchedule(data: CreateScheduleData): Promise<InstallmentSchedule>;
  updateScheduleStatus(id: string, status: InstallmentSchedule['status']): Promise<void>;
  updatePaymentStatus(
    paymentId: string,
    data: Partial<InstallmentPayment>,
    tx?: unknown,
  ): Promise<void>;
  saveRecurrenceToken(scheduleId: string, token: string): Promise<void>;
  findOverduePayments(
    now: Date,
  ): Promise<Array<{ schedule: InstallmentSchedule; payment: InstallmentPayment }>>;
  cancelTicket(ticketId: string, tx: unknown): Promise<void>;
  releaseInventory(ticketTypeId: string, tx: unknown): Promise<void>;
  withTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

export interface GoPayAdapter {
  chargeRecurring(
    token: string,
    amount: number,
    orderId: string,
  ): Promise<{ paymentId: string; success: boolean }>;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface CreateScheduleData {
  order_id: string;
  ticket_id: string;
  user_id: string;
  plan_id: string;
  total_amount: number;
  installments: Omit<InstallmentPayment, 'id'>[];
  status: InstallmentSchedule['status'];
  gopay_recurrence_token: string;
}

// ---------------------------------------------------------------------------
// InstallmentService
// ---------------------------------------------------------------------------

export class InstallmentService {
  // -------------------------------------------------------------------------
  // createSchedule
  // -------------------------------------------------------------------------

  /**
   * Creates an installment schedule for a newly purchased ticket.
   *
   * Prerequisites (caller must ensure):
   * - First GoPay payment has been successfully captured.
   * - `recurrenceToken` was returned by GoPay for subsequent charges.
   *
   * The first installment is recorded as 'paid' (already charged).
   * All subsequent installments are 'pending' with calculated due dates.
   *
   * Throws InstallmentNotSupportedError if the ticket type has no active plan.
   * Throws InstallmentAlreadyActiveError if the user already has an active schedule for this ticket.
   */
  async createSchedule(
    orderId: string,
    ticketId: string,
    userId: string,
    ticketTypeId: string,
    totalAmount: number,
    firstGopayPaymentId: string,
    recurrenceToken: string,
    db: InstallmentDbAdapter,
  ): Promise<InstallmentSchedule> {
    // 1. Load and validate plan.
    const plan = await db.findInstallmentPlan(ticketTypeId);
    if (!plan || !plan.active) {
      throw new InstallmentNotSupportedError(
        `Ticket type ${ticketTypeId} does not have an active installment plan.`,
      );
    }

    // 2. Guard: no duplicate active schedule for same ticket.
    const existing = await db.findScheduleByOrder(orderId);
    if (existing && existing.status === 'active') {
      throw new InstallmentAlreadyActiveError(
        `An active installment schedule already exists for order ${orderId}.`,
      );
    }

    // 3. Calculate amounts and due dates.
    const amounts = calculateInstallmentAmounts(totalAmount, plan);
    const now = new Date();
    const dueDates = calculateDueDates(now, plan);

    // 4. Build installment payment records.
    const installments: Omit<InstallmentPayment, 'id'>[] = amounts.map((amount, idx) => ({
      schedule_id: '', // filled in by DB layer after insert
      installment_number: idx + 1,
      amount,
      due_date: dueDates[idx],
      paid_at: idx === 0 ? now : null,
      gopay_payment_id: idx === 0 ? firstGopayPaymentId : null,
      status: idx === 0 ? ('paid' as const) : ('pending' as const),
      retry_count: 0,
      last_retry_at: null,
    }));

    // 5. Persist schedule.
    const schedule = await db.createSchedule({
      order_id: orderId,
      ticket_id: ticketId,
      user_id: userId,
      plan_id: plan.id,
      total_amount: totalAmount,
      installments,
      status: 'active',
      gopay_recurrence_token: recurrenceToken,
    });

    // 6. Save recurrence token explicitly (idempotent upsert in DB layer).
    await db.saveRecurrenceToken(schedule.id, recurrenceToken);

    return schedule;
  }

  // -------------------------------------------------------------------------
  // processOverduePayments
  // -------------------------------------------------------------------------

  /**
   * Processes all overdue installment payments.
   *
   * For each overdue payment:
   * - If retry_count < 3: attempt GoPay recurring charge.
   *   - On success: mark as 'paid', check if schedule is complete.
   *   - On failure: increment retry_count, set status to 'retrying'.
   * - If retry_count >= 3 (or just hit 3): cancel ticket + release inventory.
   *
   * Returns a summary: { charged, failed, cancelled }.
   */
  async processOverduePayments(
    db: InstallmentDbAdapter,
    gopay: GoPayAdapter,
  ): Promise<{ charged: number; failed: number; cancelled: number }> {
    const now = new Date();
    const overdue = await db.findOverduePayments(now);

    let charged = 0;
    let failed = 0;
    let cancelled = 0;

    for (const { schedule, payment } of overdue) {
      try {
        // If already exhausted retries, cancel immediately.
        if (payment.retry_count >= 3) {
          await this.cancelScheduleAndTicket(schedule, db);
          cancelled++;
          continue;
        }

        // Attempt GoPay recurring charge.
        const result = await gopay.chargeRecurring(
          schedule.gopay_recurrence_token,
          payment.amount,
          `${schedule.order_id}-installment-${payment.installment_number}`,
        );

        if (result.success) {
          // Mark as paid.
          await db.updatePaymentStatus(payment.id, {
            status: 'paid',
            paid_at: now,
            gopay_payment_id: result.paymentId,
          });

          // Check if all installments are now paid → mark schedule completed.
          const refreshed = await db.findScheduleById(schedule.id);
          if (refreshed && this.isScheduleComplete(refreshed)) {
            await db.updateScheduleStatus(schedule.id, 'completed');
          }

          charged++;
        } else {
          // Charge failed — increment retry counter.
          const newRetryCount = payment.retry_count + 1;
          const newStatus: InstallmentPayment['status'] =
            newRetryCount >= 3 ? 'failed' : 'retrying';

          await db.updatePaymentStatus(payment.id, {
            status: newStatus,
            retry_count: newRetryCount,
            last_retry_at: now,
          });

          // Cancel if this was the last allowed retry.
          if (newRetryCount >= 3) {
            // Re-load schedule to get latest state before cancellation.
            const refreshed = await db.findScheduleById(schedule.id);
            if (refreshed && shouldCancelSchedule(refreshed)) {
              await this.cancelScheduleAndTicket(refreshed, db);
              cancelled++;
            }
          }

          failed++;
        }
      } catch (err) {
        // Log and continue so one failure doesn't block all others.
        console.error(
          `[installments] Unexpected error processing payment ${payment.id} ` +
            `for schedule ${schedule.id}:`,
          err,
        );
        failed++;
      }
    }

    return { charged, failed, cancelled };
  }

  // -------------------------------------------------------------------------
  // getScheduleStatus
  // -------------------------------------------------------------------------

  /**
   * Returns the full installment schedule for an order.
   * Throws InstallmentScheduleNotFoundError if not found.
   */
  async getScheduleStatus(orderId: string, db: InstallmentDbAdapter): Promise<InstallmentSchedule> {
    const schedule = await db.findScheduleByOrder(orderId);
    if (!schedule) {
      throw new InstallmentScheduleNotFoundError(
        `No installment schedule found for order ${orderId}.`,
      );
    }
    return schedule;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private isScheduleComplete(schedule: InstallmentSchedule): boolean {
    return schedule.installments.every((p) => p.status === 'paid');
  }

  private async cancelScheduleAndTicket(
    schedule: InstallmentSchedule,
    db: InstallmentDbAdapter,
  ): Promise<void> {
    await db.withTransaction(async (tx) => {
      await db.cancelTicket(schedule.ticket_id, tx);
      // Derive ticket_type_id from schedule — DB layer must resolve this.
      // We pass a sentinel; real adapter looks up ticket_type_id via ticket_id.
      await db.releaseInventory(schedule.ticket_id, tx);
      await db.updateScheduleStatus(schedule.id, 'cancelled');
    });

    console.info(
      `[installments] Schedule ${schedule.id} cancelled after payment failure. ` +
        `Ticket ${schedule.ticket_id} released.`,
    );
  }

  // Exposed for use by the cron job health check.
  getNextPendingPayment(schedule: InstallmentSchedule, now: Date): InstallmentPayment | null {
    return getNextPendingPayment(schedule, now);
  }
}
