// =============================================================================
// Tap to Pay Service — Contactless Phone NFC Payment
// Feature #163: No hardware reader needed; Stripe Tap to Pay SDK
// Extends POS (#30); designed for small events without terminal hardware
//
// Flow:
//   1. openTapSession — staff identifies device + event
//   2. initiateTapPayment — creates Stripe PaymentIntent (card_present)
//   3. completeTapPayment — confirms result after SDK collects card tap
//   4. closeTapSession — end of shift
// =============================================================================

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export type Platform = 'ios' | 'android';

export interface TapSession {
  id: string;
  eventId: string;
  promoterId: string;
  staffUserId: string;
  deviceId: string;
  platform: Platform;
  stripeReaderId: string | null;
  status: 'active' | 'closed';
  openedAt: string;
  closedAt: string | null;
}

export interface TapTransaction {
  id: string;
  sessionId: string;
  paymentIntentId: string | null;
  amountHellers: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed' | 'cancelled';
  ticketTypeId: string | null;
  quantity: number;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface SessionRow {
  id: string;
  event_id: string;
  promoter_id: string;
  staff_user_id: string;
  device_id: string;
  platform: string;
  stripe_reader_id: string | null;
  status: string;
  opened_at: string;
  closed_at: string | null;
}

interface TransactionRow {
  id: string;
  session_id: string;
  payment_intent_id: string | null;
  amount_hellers: number;
  currency: string;
  status: string;
  ticket_type_id: string | null;
  quantity: number;
  error_code: string | null;
  created_at: string;
  completed_at: string | null;
}

function mapSession(r: SessionRow): TapSession {
  return {
    id: r.id,
    eventId: r.event_id,
    promoterId: r.promoter_id,
    staffUserId: r.staff_user_id,
    deviceId: r.device_id,
    platform: r.platform as Platform,
    stripeReaderId: r.stripe_reader_id,
    status: r.status as TapSession['status'],
    openedAt: r.opened_at,
    closedAt: r.closed_at,
  };
}

function mapTransaction(r: TransactionRow): TapTransaction {
  return {
    id: r.id,
    sessionId: r.session_id,
    paymentIntentId: r.payment_intent_id,
    amountHellers: r.amount_hellers,
    currency: r.currency,
    status: r.status as TapTransaction['status'],
    ticketTypeId: r.ticket_type_id,
    quantity: r.quantity,
    errorCode: r.error_code,
    createdAt: r.created_at,
    completedAt: r.completed_at,
  };
}

/**
 * Open a Tap to Pay session for a staff member's mobile device.
 */
export async function openTapSession(
  input: {
    eventId: string;
    promoterId: string;
    staffUserId: string;
    deviceId: string;
    platform: Platform;
  },
  db: DbAdapter,
): Promise<TapSession> {
  if (!input.deviceId.trim()) throw new Error('VALIDATION_ERROR: deviceId is required');

  const rows = await db.query<SessionRow>(
    `INSERT INTO pos.tap_to_pay_sessions
       (event_id, promoter_id, staff_user_id, device_id, platform)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [input.eventId, input.promoterId, input.staffUserId, input.deviceId, input.platform],
  );

  return mapSession(rows[0]);
}

/**
 * Initiate a tap payment: create the PaymentIntent on Stripe (server-side).
 * The Stripe client SDK then presents the NFC collection UI.
 */
export async function initiateTapPayment(
  sessionId: string,
  amountHellers: number,
  ticketTypeId: string | null,
  quantity: number,
  currency: string,
  db: DbAdapter,
): Promise<TapTransaction> {
  if (amountHellers <= 0) throw new Error('VALIDATION_ERROR: amountHellers must be positive');

  const stripeKey = process.env['STRIPE_SECRET_KEY'];
  if (!stripeKey) throw new Error('STRIPE_KEY_MISSING');

  const sessions = await db.query<SessionRow>(
    `SELECT * FROM pos.tap_to_pay_sessions WHERE id = $1 AND status = 'active'`,
    [sessionId],
  );
  if (!sessions[0]) throw new Error('SESSION_NOT_FOUND or not active');

  // Create PaymentIntent via Stripe API
  const response = await fetch('https://api.stripe.com/v1/payment_intents', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      amount: String(amountHellers),
      currency: currency.toLowerCase(),
      'payment_method_types[]': 'card_present',
      capture_method: 'automatic',
    }),
  });

  if (!response.ok) {
    const err = await response.json() as { error?: { code?: string } };
    const code = err?.error?.code ?? 'STRIPE_ERROR';
    const tx = await db.query<TransactionRow>(
      `INSERT INTO pos.tap_to_pay_transactions
         (session_id, amount_hellers, currency, status, ticket_type_id, quantity, error_code)
       VALUES ($1, $2, $3, 'failed', $4, $5, $6)
       RETURNING *`,
      [sessionId, amountHellers, currency, ticketTypeId, quantity, code],
    );
    return mapTransaction(tx[0]);
  }

  const intent = await response.json() as { id: string };

  const rows = await db.query<TransactionRow>(
    `INSERT INTO pos.tap_to_pay_transactions
       (session_id, payment_intent_id, amount_hellers, currency, status, ticket_type_id, quantity)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6)
     RETURNING *`,
    [sessionId, intent.id, amountHellers, currency, ticketTypeId, quantity],
  );

  return mapTransaction(rows[0]);
}

/**
 * Complete a tap payment after the mobile SDK reports success/failure.
 */
export async function completeTapPayment(
  transactionId: string,
  result: 'succeeded' | 'failed' | 'cancelled',
  errorCode: string | null,
  db: DbAdapter,
): Promise<TapTransaction> {
  const rows = await db.query<TransactionRow>(
    `UPDATE pos.tap_to_pay_transactions
     SET status = $2, error_code = $3, completed_at = NOW()
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [transactionId, result, errorCode],
  );

  if (!rows[0]) throw new Error('TRANSACTION_NOT_FOUND or not pending');
  return mapTransaction(rows[0]);
}

/**
 * Close a Tap to Pay session.
 */
export async function closeTapSession(
  sessionId: string,
  staffUserId: string,
  db: DbAdapter,
): Promise<TapSession> {
  const rows = await db.query<SessionRow>(
    `UPDATE pos.tap_to_pay_sessions
     SET status = 'closed', closed_at = NOW()
     WHERE id = $1 AND staff_user_id = $2 AND status = 'active'
     RETURNING *`,
    [sessionId, staffUserId],
  );
  if (!rows[0]) throw new Error('SESSION_NOT_FOUND or already closed');
  return mapSession(rows[0]);
}

/**
 * Get session transactions summary.
 */
export async function getSessionSummary(
  sessionId: string,
  db: DbAdapter,
): Promise<{ totalTransactions: number; totalSucceeded: number; totalAmountHellers: number }> {
  const rows = await db.query<{
    total: string;
    succeeded: string;
    total_amount: string;
  }>(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE status = 'succeeded') AS succeeded,
       COALESCE(SUM(amount_hellers) FILTER (WHERE status = 'succeeded'), 0) AS total_amount
     FROM pos.tap_to_pay_transactions
     WHERE session_id = $1`,
    [sessionId],
  );

  const r = rows[0];
  return {
    totalTransactions: Number(r?.total ?? 0),
    totalSucceeded: Number(r?.succeeded ?? 0),
    totalAmountHellers: Number(r?.total_amount ?? 0),
  };
}
