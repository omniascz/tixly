// =============================================================================
// BNPL Service
//
// Orchestrates BNPL payments across Twisto and Klarna providers.
// Adapters for HTTP calls and DB are injected via ServiceDeps.
// =============================================================================

import {
  BnplError,
  type BnplPayment,
  type BnplPaymentStatus,
  type BnplProvider,
  type InitiateBnplInput,
  type ServiceDeps,
} from '../types/bnpl.types';
import {
  checkEligibility,
  MAX_AMOUNT_CZK,
  MIN_AMOUNT_CZK,
} from '../lib/eligibility';

// ---------------------------------------------------------------------------
// DB row mapping (snake_case → camelCase)
// ---------------------------------------------------------------------------

interface BnplPaymentRow {
  id: string;
  order_id: string;
  user_id: string;
  provider: BnplProvider;
  provider_payment_id: string | null;
  amount_czk: number;
  due_date: Date | string;
  deferral_days: number;
  status: BnplPaymentStatus;
  approved_at: Date | string | null;
  paid_at: Date | string | null;
  failure_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function toDate(v: Date | string | null): Date | null {
  if (v === null) return null;
  return v instanceof Date ? v : new Date(v);
}

function mapRow(row: BnplPaymentRow): BnplPayment {
  return {
    id: row.id,
    orderId: row.order_id,
    userId: row.user_id,
    provider: row.provider,
    providerPaymentId: row.provider_payment_id,
    amountCzk: row.amount_czk,
    dueDate: toDate(row.due_date) as Date,
    deferralDays: row.deferral_days,
    status: row.status,
    approvedAt: toDate(row.approved_at),
    paidAt: toDate(row.paid_at),
    failureReason: row.failure_reason,
    createdAt: toDate(row.created_at) as Date,
    updatedAt: toDate(row.updated_at) as Date,
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function addDays(base: Date, days: number): Date {
  const out = new Date(base.getTime());
  out.setDate(out.getDate() + days);
  return out;
}

function newId(): string {
  // Service does not depend on a UUID package — adapters may override.
  // A simple timestamp-random id keeps tests deterministic enough with mocks.
  return `bnpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// initiateBnplPayment
// ---------------------------------------------------------------------------

export async function initiateBnplPayment(
  input: InitiateBnplInput,
  deps: ServiceDeps,
): Promise<BnplPayment> {
  const { db, twisto, klarna } = deps;

  // 1. Validate amount bounds.
  if (input.amountCzk < MIN_AMOUNT_CZK) {
    throw new BnplError('AMOUNT_TOO_LOW', `Amount ${input.amountCzk} is below minimum ${MIN_AMOUNT_CZK}.`);
  }
  if (input.amountCzk > MAX_AMOUNT_CZK) {
    throw new BnplError('AMOUNT_TOO_HIGH', `Amount ${input.amountCzk} exceeds maximum ${MAX_AMOUNT_CZK}.`);
  }

  // 2. Validate deferral days.
  if (input.deferralDays !== 14 && input.deferralDays !== 30) {
    throw new BnplError(
      'INVALID_DEFERRAL_DAYS',
      `deferralDays must be 14 or 30 (got ${input.deferralDays}).`,
    );
  }

  // 3. Load user's past BNPL payments and run eligibility check.
  const pastRows = await db.query<BnplPaymentRow>(
    'SELECT * FROM orders.bnpl_payments WHERE user_id = $1',
    [input.userId],
  );
  const pastPayments = pastRows.map(mapRow);

  const eligibility = checkEligibility(
    input.userId,
    input.amountCzk,
    input.provider,
    pastPayments,
  );

  if (!eligibility.eligible) {
    throw new BnplError(
      'USER_NOT_ELIGIBLE',
      eligibility.reason ?? 'User is not eligible for BNPL.',
    );
  }

  // 4. Insert a pending DB row.
  const now = new Date();
  const id = newId();
  const dueDate = addDays(now, input.deferralDays);

  await db.execute(
    `INSERT INTO orders.bnpl_payments
      (id, order_id, user_id, provider, provider_payment_id,
       amount_czk, due_date, deferral_days, status,
       approved_at, paid_at, failure_reason, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', NULL, NULL, NULL, $9, $9)`,
    [
      id,
      input.orderId,
      input.userId,
      input.provider,
      null,
      input.amountCzk,
      dueDate,
      input.deferralDays,
      now,
    ],
  );

  // 5. Dispatch to provider.
  let providerPaymentId: string | null = null;
  let newStatus: BnplPaymentStatus;
  let approvedAt: Date | null = null;
  let failureReason: string | null = null;

  try {
    if (input.provider === 'twisto') {
      const result = await twisto.createPayment({
        amount: input.amountCzk,
        currency: 'CZK',
        orderId: input.orderId,
        customer: {
          email: input.customerEmail,
          name: input.customerName,
          phone: input.customerPhone,
          birthDate: input.customerBirthDate,
        },
        deferralDays: input.deferralDays,
      });
      providerPaymentId = result.paymentId;
      if (result.approved) {
        newStatus = 'approved';
        approvedAt = now;
      } else {
        newStatus = 'rejected';
        failureReason = result.rejectReason ?? 'Provider rejected the payment.';
      }
    } else if (input.provider === 'klarna') {
      const session = await klarna.createSession({
        amount: input.amountCzk,
        currency: 'CZK',
        orderId: input.orderId,
        customer: { email: input.customerEmail, name: input.customerName },
      });
      if (!session.approved) {
        providerPaymentId = session.sessionId;
        newStatus = 'rejected';
        failureReason = 'Klarna session was not approved.';
      } else {
        const auth = await klarna.authorizePayment(session.sessionId);
        providerPaymentId = auth.paymentId;
        if (auth.status === 'authorized' || auth.status === 'approved') {
          newStatus = 'approved';
          approvedAt = now;
        } else {
          newStatus = 'rejected';
          failureReason = `Klarna authorization failed: ${auth.status}`;
        }
      }
    } else {
      throw new BnplError('PROVIDER_ERROR', `Unknown provider: ${input.provider}`);
    }
  } catch (err) {
    if (err instanceof BnplError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    // Persist the failure reason before surfacing the error.
    await db.execute(
      `UPDATE orders.bnpl_payments
         SET status = 'rejected',
             failure_reason = $2,
             updated_at = $3
       WHERE id = $1`,
      [id, `Provider error: ${msg}`, new Date()],
    );
    throw new BnplError('PROVIDER_ERROR', msg);
  }

  // 6. Persist the provider outcome.
  const updatedAt = new Date();
  await db.execute(
    `UPDATE orders.bnpl_payments
       SET provider_payment_id = $2,
           status = $3,
           approved_at = $4,
           failure_reason = $5,
           updated_at = $6
     WHERE id = $1`,
    [id, providerPaymentId, newStatus, approvedAt, failureReason, updatedAt],
  );

  if (newStatus === 'rejected') {
    throw new BnplError(
      'PROVIDER_REJECTED',
      failureReason ?? 'Provider rejected the BNPL payment.',
    );
  }

  return {
    id,
    orderId: input.orderId,
    userId: input.userId,
    provider: input.provider,
    providerPaymentId,
    amountCzk: input.amountCzk,
    dueDate,
    deferralDays: input.deferralDays,
    status: newStatus,
    approvedAt,
    paidAt: null,
    failureReason,
    createdAt: now,
    updatedAt,
  };
}

// ---------------------------------------------------------------------------
// getBnplPayment
// ---------------------------------------------------------------------------

export async function getBnplPayment(
  paymentId: string,
  deps: ServiceDeps,
): Promise<BnplPayment> {
  const { db } = deps;
  const rows = await db.query<BnplPaymentRow>(
    'SELECT * FROM orders.bnpl_payments WHERE id = $1',
    [paymentId],
  );
  if (rows.length === 0) {
    throw new BnplError('PAYMENT_NOT_FOUND', `BNPL payment ${paymentId} not found.`);
  }
  return mapRow(rows[0]!);
}

// ---------------------------------------------------------------------------
// listBnplPaymentsForUser
// ---------------------------------------------------------------------------

export async function listBnplPaymentsForUser(
  userId: string,
  deps: ServiceDeps,
): Promise<BnplPayment[]> {
  const { db } = deps;
  const rows = await db.query<BnplPaymentRow>(
    'SELECT * FROM orders.bnpl_payments WHERE user_id = $1 ORDER BY created_at DESC',
    [userId],
  );
  return rows.map(mapRow);
}

// ---------------------------------------------------------------------------
// markAsDelivered
// ---------------------------------------------------------------------------

export async function markAsDelivered(
  paymentId: string,
  deps: ServiceDeps,
): Promise<BnplPayment> {
  const payment = await getBnplPayment(paymentId, deps);

  if (payment.status !== 'approved') {
    throw new BnplError(
      'PAYMENT_NOT_CANCELLABLE',
      `Only 'approved' payments can be marked as delivered (got '${payment.status}').`,
    );
  }

  const { db } = deps;
  const now = new Date();
  await db.execute(
    `UPDATE orders.bnpl_payments
       SET status = 'active',
           updated_at = $2
     WHERE id = $1`,
    [paymentId, now],
  );

  return { ...payment, status: 'active', updatedAt: now };
}

// ---------------------------------------------------------------------------
// cancelBnplPayment
// ---------------------------------------------------------------------------

export async function cancelBnplPayment(
  paymentId: string,
  _userId: string,
  deps: ServiceDeps,
): Promise<BnplPayment> {
  const payment = await getBnplPayment(paymentId, deps);

  if (payment.status !== 'pending' && payment.status !== 'approved') {
    throw new BnplError(
      'PAYMENT_NOT_CANCELLABLE',
      `Cannot cancel payment with status '${payment.status}'.`,
    );
  }

  const { db, twisto, klarna } = deps;

  if (payment.providerPaymentId) {
    try {
      if (payment.provider === 'twisto') {
        await twisto.cancelPayment(payment.providerPaymentId);
      } else if (payment.provider === 'klarna') {
        await klarna.cancelOrder(payment.providerPaymentId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BnplError('PROVIDER_ERROR', `Failed to cancel at provider: ${msg}`);
    }
  }

  const now = new Date();
  await db.execute(
    `UPDATE orders.bnpl_payments
       SET status = 'cancelled',
           updated_at = $2
     WHERE id = $1`,
    [paymentId, now],
  );

  return { ...payment, status: 'cancelled', updatedAt: now };
}

// ---------------------------------------------------------------------------
// syncBnplStatus
// ---------------------------------------------------------------------------

export async function syncBnplStatus(
  paymentId: string,
  deps: ServiceDeps,
): Promise<BnplPayment> {
  const payment = await getBnplPayment(paymentId, deps);

  if (payment.status !== 'active') {
    // Nothing to sync for non-active payments.
    return payment;
  }

  if (!payment.providerPaymentId) {
    throw new BnplError(
      'PROVIDER_ERROR',
      'Active BNPL payment has no provider payment ID.',
    );
  }

  const { db, twisto, klarna } = deps;

  let providerStatus: string;
  let providerPaidAt: string | undefined;

  try {
    if (payment.provider === 'twisto') {
      const res = await twisto.getPaymentStatus(payment.providerPaymentId);
      providerStatus = res.status;
      providerPaidAt = res.paidAt;
    } else {
      const res = await klarna.getOrderStatus(payment.providerPaymentId);
      providerStatus = res.status;
      providerPaidAt = res.capturedAt;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new BnplError('PROVIDER_ERROR', `Failed to fetch provider status: ${msg}`);
  }

  const normalized = providerStatus.toLowerCase();
  const now = new Date();

  if (normalized === 'paid' || normalized === 'captured') {
    const paidAt = providerPaidAt ? new Date(providerPaidAt) : now;
    await db.execute(
      `UPDATE orders.bnpl_payments
         SET status = 'paid',
             paid_at = $2,
             updated_at = $3
       WHERE id = $1`,
      [paymentId, paidAt, now],
    );
    return { ...payment, status: 'paid', paidAt, updatedAt: now };
  }

  if (normalized === 'defaulted' || normalized === 'default') {
    await db.execute(
      `UPDATE orders.bnpl_payments
         SET status = 'defaulted',
             updated_at = $2
       WHERE id = $1`,
      [paymentId, now],
    );
    return { ...payment, status: 'defaulted', updatedAt: now };
  }

  // Unchanged.
  return payment;
}

// ---------------------------------------------------------------------------
// getOverduePayments
// ---------------------------------------------------------------------------

export async function getOverduePayments(
  deps: ServiceDeps,
): Promise<BnplPayment[]> {
  const { db } = deps;
  const rows = await db.query<BnplPaymentRow>(
    `SELECT * FROM orders.bnpl_payments
      WHERE status = 'active' AND due_date < NOW()`,
  );
  return rows.map(mapRow);
}

// ---------------------------------------------------------------------------
// markAsOverdue
// ---------------------------------------------------------------------------

export async function markAsOverdue(
  paymentId: string,
  deps: ServiceDeps,
): Promise<BnplPayment> {
  const payment = await getBnplPayment(paymentId, deps);

  if (payment.status !== 'active') {
    throw new BnplError(
      'PAYMENT_NOT_CANCELLABLE',
      `Only 'active' payments can be marked overdue (got '${payment.status}').`,
    );
  }

  const { db } = deps;
  const now = new Date();
  await db.execute(
    `UPDATE orders.bnpl_payments
       SET status = 'overdue',
           updated_at = $2
     WHERE id = $1`,
    [paymentId, now],
  );
  return { ...payment, status: 'overdue', updatedAt: now };
}
