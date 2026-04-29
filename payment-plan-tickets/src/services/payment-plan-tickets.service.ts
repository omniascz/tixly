import { randomUUID } from 'crypto';
import type { DbAdapter, PaymentPlan, PlanType, TicketInstallment, InstallmentSchedule } from '../lib/types.js';

// ─── Internal DB row shapes ──────────────────────────────────────────────────

interface PlanRow {
  id: string;
  ticket_type_id: string;
  promoter_id: string;
  plan_type: string;
  enabled: boolean;
  down_payment_percent: number;
  issue_ticket_after: string;
  created_at: string;
}

interface InstallmentRow {
  id: string;
  plan_id: string;
  order_id: string;
  ticket_id: string | null;
  plan_type: string;
  total_amount_halire: number;
  paid_amount_halire: number;
  remaining_halire: number;
  installments: InstallmentSchedule[] | string;
  status: string;
  next_payment_at: string | null;
  created_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rowToPlan(row: PlanRow): PaymentPlan {
  return {
    id: row.id,
    ticketTypeId: row.ticket_type_id,
    promoterId: row.promoter_id,
    planType: row.plan_type as PlanType,
    enabled: row.enabled,
    downPaymentPercent: row.down_payment_percent,
    issueTicketAfter: row.issue_ticket_after as PaymentPlan['issueTicketAfter'],
  };
}

function rowToInstallment(row: InstallmentRow): TicketInstallment {
  const installments: InstallmentSchedule[] =
    typeof row.installments === 'string'
      ? (JSON.parse(row.installments) as InstallmentSchedule[])
      : row.installments;
  const nextPayment = installments.find((i) => i.status === 'pending');
  return {
    id: row.id,
    planId: row.plan_id,
    orderId: row.order_id,
    ticketId: row.ticket_id ?? undefined,
    planType: row.plan_type as PlanType,
    totalAmountHalire: row.total_amount_halire,
    paidAmountHalire: row.paid_amount_halire,
    remainingHalire: row.remaining_halire,
    installments,
    status: row.status as TicketInstallment['status'],
    nextPaymentAt: row.next_payment_at ?? (nextPayment?.dueAt ?? new Date().toISOString()),
    createdAt: typeof row.created_at === 'string' ? row.created_at : new Date(row.created_at).toISOString(),
  };
}

function planTypeToCount(planType: PlanType): number {
  switch (planType) {
    case 'split_3': return 3;
    case 'split_6': return 6;
    case 'split_12': return 12;
  }
}

function buildSchedule(
  totalAmountHalire: number,
  downPaymentPercent: number,
  planType: PlanType,
  startDate: Date,
): InstallmentSchedule[] {
  const count = planTypeToCount(planType);
  const firstAmount = Math.round((totalAmountHalire * downPaymentPercent) / 100);
  const remaining = totalAmountHalire - firstAmount;
  const perInstallment = Math.floor(remaining / (count - 1));
  // last installment absorbs rounding remainder
  const lastInstallment = totalAmountHalire - firstAmount - perInstallment * (count - 2);

  const schedule: InstallmentSchedule[] = [];

  for (let i = 1; i <= count; i++) {
    let amount: number;
    if (i === 1) {
      amount = firstAmount;
    } else if (i === count) {
      amount = lastInstallment;
    } else {
      amount = perInstallment;
    }

    const dueDate = new Date(startDate);
    dueDate.setDate(dueDate.getDate() + (i - 1) * 30);

    schedule.push({
      number: i,
      amountHalire: amount,
      dueAt: dueDate.toISOString(),
      status: 'pending',
    });
  }

  return schedule;
}

// ─── Service functions ────────────────────────────────────────────────────────

/**
 * Konfiguruje payment plan pro ticket type.
 */
export async function setupPaymentPlan(
  ticketTypeId: string,
  promoterId: string,
  plan: Omit<PaymentPlan, 'id'>,
  db: DbAdapter,
): Promise<PaymentPlan> {
  if (plan.downPaymentPercent < 1 || plan.downPaymentPercent > 100) {
    throw new Error('downPaymentPercent musí být mezi 1 a 100');
  }

  const id = randomUUID();
  await db.execute(
    `INSERT INTO ticket_payment_plans
       (id, ticket_type_id, promoter_id, plan_type, enabled, down_payment_percent, issue_ticket_after)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, ticketTypeId, promoterId, plan.planType, plan.enabled, plan.downPaymentPercent, plan.issueTicketAfter],
  );

  return { id, ...plan };
}

/**
 * Inicializuje splátky pro objednávku.
 */
export async function initializeInstallments(
  orderId: string,
  ticketTypeId: string,
  totalAmountHalire: number,
  planType: PlanType,
  db: DbAdapter,
): Promise<TicketInstallment> {
  // Find active plan for this ticket type
  const planRows = await db.query<PlanRow>(
    `SELECT * FROM ticket_payment_plans WHERE ticket_type_id = $1 AND plan_type = $2 AND enabled = true LIMIT 1`,
    [ticketTypeId, planType],
  );

  const downPaymentPercent = planRows.length > 0 ? planRows[0].down_payment_percent : 33;
  const issueTicketAfter = planRows.length > 0 ? planRows[0].issue_ticket_after : 'first_payment';
  const planId = planRows.length > 0 ? planRows[0].id : randomUUID();

  const now = new Date();
  const schedule = buildSchedule(totalAmountHalire, downPaymentPercent, planType, now);
  const nextPaymentAt = schedule[0]?.dueAt ?? now.toISOString();

  const id = randomUUID();
  await db.execute(
    `INSERT INTO ticket_installments
       (id, plan_id, order_id, plan_type, total_amount_halire, paid_amount_halire, remaining_halire, installments, status, next_payment_at)
     VALUES ($1, $2, $3, $4, $5, 0, $5, $6, 'active', $7)`,
    [id, planId, orderId, planType, totalAmountHalire, JSON.stringify(schedule), nextPaymentAt],
  );

  return {
    id,
    planId,
    orderId,
    planType,
    totalAmountHalire,
    paidAmountHalire: 0,
    remainingHalire: totalAmountHalire,
    installments: schedule,
    status: 'active',
    issueTicketAfter,
    nextPaymentAt,
    createdAt: now.toISOString(),
  } as TicketInstallment & { issueTicketAfter: string };
}

/**
 * Zaznamená přijatou platbu.
 */
export async function recordInstallmentPayment(
  installmentId: string,
  installmentNumber: number,
  amountHalire: number,
  db: DbAdapter,
): Promise<TicketInstallment> {
  const rows = await db.query<InstallmentRow>(
    `SELECT * FROM ticket_installments WHERE id = $1`,
    [installmentId],
  );
  if (rows.length === 0) {
    throw new Error(`Installment ${installmentId} nenalezen`);
  }
  const current = rowToInstallment(rows[0]);

  const schedule = current.installments;
  const installment = schedule.find((i) => i.number === installmentNumber);
  if (!installment) {
    throw new Error(`Splátka číslo ${installmentNumber} nenalezena`);
  }
  if (amountHalire !== installment.amountHalire) {
    throw new Error(
      `Nesprávná výše platby: očekáváno ${installment.amountHalire}, obdrženo ${amountHalire}`,
    );
  }

  installment.status = 'paid';
  installment.paidAt = new Date().toISOString();

  const newPaid = current.paidAmountHalire + amountHalire;
  const newRemaining = current.totalAmountHalire - newPaid;
  const allPaid = schedule.every((i) => i.status === 'paid');
  const newStatus: TicketInstallment['status'] = allPaid ? 'completed' : 'active';

  const nextPending = schedule.find((i) => i.status === 'pending');
  const nextPaymentAt = nextPending?.dueAt ?? new Date().toISOString();

  await db.execute(
    `UPDATE ticket_installments
     SET paid_amount_halire = $2,
         remaining_halire = $3,
         installments = $4,
         status = $5,
         next_payment_at = $6
     WHERE id = $1`,
    [installmentId, newPaid, newRemaining, JSON.stringify(schedule), newStatus, nextPaymentAt],
  );

  return {
    ...current,
    paidAmountHalire: newPaid,
    remainingHalire: newRemaining,
    installments: schedule,
    status: newStatus,
    nextPaymentAt,
  };
}

/**
 * Vydá vstupenku po první splátce (pokud issueTicketAfter='first_payment').
 */
export async function issueTicketAfterFirstPayment(
  installmentId: string,
  db: DbAdapter,
): Promise<{ ticketId: string } | null> {
  const rows = await db.query<InstallmentRow>(
    `SELECT * FROM ticket_installments WHERE id = $1`,
    [installmentId],
  );
  if (rows.length === 0) {
    throw new Error(`Installment ${installmentId} nenalezen`);
  }

  // Check if associated plan has issueTicketAfter='first_payment'
  const planRows = await db.query<PlanRow>(
    `SELECT * FROM ticket_payment_plans WHERE id = $1`,
    [rows[0].plan_id],
  );

  if (planRows.length === 0 || planRows[0].issue_ticket_after !== 'first_payment') {
    return null;
  }

  const ticketId = randomUUID();
  await db.execute(
    `UPDATE ticket_installments SET ticket_id = $2 WHERE id = $1`,
    [installmentId, ticketId],
  );
  return { ticketId };
}

/**
 * Označí jako defaulted (pro dunning cron — 14+ dní po splatnosti).
 */
export async function markAsDefaulted(
  installmentId: string,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `UPDATE ticket_installments SET status = 'defaulted' WHERE id = $1`,
    [installmentId],
  );
}

/**
 * Statistiky splátek pro promotéra.
 */
export async function getInstallmentStats(
  promoterId: string,
  db: DbAdapter,
): Promise<{
  activeCount: number;
  completedCount: number;
  defaultedCount: number;
  totalOutstandingHalire: number;
}> {
  // Get all installments for plans belonging to promoter
  const rows = await db.query<{
    status: string;
    remaining_halire: number;
  }>(
    `SELECT ti.status, ti.remaining_halire
     FROM ticket_installments ti
     JOIN ticket_payment_plans tpp ON tpp.id = ti.plan_id
     WHERE tpp.promoter_id = $1`,
    [promoterId],
  );

  let activeCount = 0;
  let completedCount = 0;
  let defaultedCount = 0;
  let totalOutstandingHalire = 0;

  for (const row of rows) {
    switch (row.status) {
      case 'active':
        activeCount++;
        totalOutstandingHalire += Number(row.remaining_halire);
        break;
      case 'completed':
        completedCount++;
        break;
      case 'defaulted':
        defaultedCount++;
        break;
    }
  }

  return { activeCount, completedCount, defaultedCount, totalOutstandingHalire };
}
