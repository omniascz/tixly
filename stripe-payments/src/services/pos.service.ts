// =============================================================================
// POS Service — Stripe Terminal / Box Office
// Feature #30: Physical in-venue sales via tablet + Stripe Terminal card reader
//
// Flow:
//   1. Staff opens a POS session (shift start) with their terminal reader ID
//   2. For each sale: createPaymentIntent → Stripe collects card present payment
//   3. Session closed + reconciled at shift end
// =============================================================================

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export interface PosSession {
  id: string;
  eventId: string;
  promoterId: string;
  staffUserId: string;
  terminalId: string;
  locationId: string | null;
  status: 'open' | 'closed' | 'reconciled';
  openedAt: string;
  closedAt: string | null;
  reconciledAt: string | null;
}

export interface PosTransaction {
  id: string;
  sessionId: string;
  orderId: string | null;
  paymentIntentId: string | null;
  terminalReaderId: string;
  amountHellers: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  ticketTypes: Array<{ ticketTypeId: string; quantity: number; unitPriceHellers: number }>;
  paymentMethodType: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface PosReconciliation {
  id: string;
  sessionId: string;
  totalTransactions: number;
  totalSucceeded: number;
  totalFailed: number;
  grossAmountHellers: number;
  netAmountHellers: number;
  discrepancyHellers: number;
  reconciledBy: string;
  notes: string | null;
  createdAt: string;
}

interface SessionRow {
  id: string;
  event_id: string;
  promoter_id: string;
  staff_user_id: string;
  terminal_id: string;
  location_id: string | null;
  status: string;
  opened_at: string;
  closed_at: string | null;
  reconciled_at: string | null;
}

interface TransactionRow {
  id: string;
  session_id: string;
  order_id: string | null;
  payment_intent_id: string | null;
  terminal_reader_id: string;
  amount_hellers: number;
  currency: string;
  status: string;
  ticket_types: string;
  payment_method_type: string | null;
  created_at: string;
  completed_at: string | null;
}

interface ReconciliationRow {
  id: string;
  session_id: string;
  total_transactions: number;
  total_succeeded: number;
  total_failed: number;
  gross_amount_hellers: string;
  net_amount_hellers: string;
  discrepancy_hellers: number;
  reconciled_by: string;
  notes: string | null;
  created_at: string;
}

function mapSession(r: SessionRow): PosSession {
  return {
    id: r.id,
    eventId: r.event_id,
    promoterId: r.promoter_id,
    staffUserId: r.staff_user_id,
    terminalId: r.terminal_id,
    locationId: r.location_id,
    status: r.status as PosSession['status'],
    openedAt: r.opened_at,
    closedAt: r.closed_at,
    reconciledAt: r.reconciled_at,
  };
}

function mapTransaction(r: TransactionRow): PosTransaction {
  return {
    id: r.id,
    sessionId: r.session_id,
    orderId: r.order_id,
    paymentIntentId: r.payment_intent_id,
    terminalReaderId: r.terminal_reader_id,
    amountHellers: r.amount_hellers,
    currency: r.currency,
    status: r.status as PosTransaction['status'],
    ticketTypes: typeof r.ticket_types === 'string' ? JSON.parse(r.ticket_types) : r.ticket_types,
    paymentMethodType: r.payment_method_type,
    createdAt: r.created_at,
    completedAt: r.completed_at,
  };
}

function mapReconciliation(r: ReconciliationRow): PosReconciliation {
  return {
    id: r.id,
    sessionId: r.session_id,
    totalTransactions: r.total_transactions,
    totalSucceeded: r.total_succeeded,
    totalFailed: r.total_failed,
    grossAmountHellers: Number(r.gross_amount_hellers),
    netAmountHellers: Number(r.net_amount_hellers),
    discrepancyHellers: r.discrepancy_hellers,
    reconciledBy: r.reconciled_by,
    notes: r.notes,
    createdAt: r.created_at,
  };
}

/**
 * Open a new POS session for a staff member at an event.
 */
export async function openPosSession(
  eventId: string,
  promoterId: string,
  staffUserId: string,
  terminalId: string,
  locationId: string | null,
  db: DbAdapter,
): Promise<PosSession> {
  if (!eventId || !promoterId || !staffUserId || !terminalId) {
    throw new Error('VALIDATION_ERROR: eventId, promoterId, staffUserId, terminalId are required');
  }

  const rows = await db.query<SessionRow>(
    `INSERT INTO pos.pos_sessions (event_id, promoter_id, staff_user_id, terminal_id, location_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [eventId, promoterId, staffUserId, terminalId, locationId],
  );

  return mapSession(rows[0]);
}

/**
 * Create a Stripe Terminal PaymentIntent for a card-present sale.
 * Uses Stripe's capture_method=manual so the terminal can collect the payment.
 */
export async function createPosPaymentIntent(
  sessionId: string,
  amountHellers: number,
  currency: string,
  ticketTypes: Array<{ ticketTypeId: string; quantity: number; unitPriceHellers: number }>,
  db: DbAdapter,
): Promise<{ transaction: PosTransaction; clientSecret: string }> {
  if (amountHellers <= 0) {
    throw new Error('VALIDATION_ERROR: amount must be positive');
  }

  // Verify session is open before requiring Stripe key
  const sessions = await db.query<SessionRow>(
    `SELECT * FROM pos.pos_sessions WHERE id = $1 AND status = 'open'`,
    [sessionId],
  );
  if (!sessions[0]) throw new Error('SESSION_NOT_FOUND: session does not exist or is not open');

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('STRIPE_KEY_MISSING');

  const session = sessions[0];

  // Create Stripe Terminal PaymentIntent
  const body = new URLSearchParams({
    amount: String(amountHellers),
    currency: currency.toLowerCase(),
    payment_method_types: 'card_present',
    capture_method: 'automatic',
    [`metadata[session_id]`]: sessionId,
    [`metadata[event_id]`]: session.event_id,
  });

  const response = await fetch('https://api.stripe.com/v1/payment_intents', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    const err = await response.json() as { error?: { message?: string } };
    throw new Error(`STRIPE_ERROR: ${err.error?.message ?? 'unknown'}`);
  }

  const pi = await response.json() as { id: string; client_secret: string };

  // Record transaction in DB
  const txRows = await db.query<TransactionRow>(
    `INSERT INTO pos.pos_transactions
       (session_id, payment_intent_id, terminal_reader_id, amount_hellers, currency, ticket_types)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      sessionId,
      pi.id,
      session.terminal_id,
      amountHellers,
      currency.toUpperCase(),
      JSON.stringify(ticketTypes),
    ],
  );

  return {
    transaction: mapTransaction(txRows[0]),
    clientSecret: pi.client_secret,
  };
}

/**
 * Process a completed card payment: update transaction status.
 * Called after Stripe Terminal confirms the payment.
 */
export async function processCardPayment(
  transactionId: string,
  stripeStatus: 'succeeded' | 'failed',
  paymentMethodType: string | null,
  db: DbAdapter,
): Promise<PosTransaction> {
  const rows = await db.query<TransactionRow>(
    `UPDATE pos.pos_transactions
     SET status = $2,
         payment_method_type = $3,
         completed_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [transactionId, stripeStatus, paymentMethodType],
  );

  if (!rows[0]) throw new Error('TRANSACTION_NOT_FOUND');
  return mapTransaction(rows[0]);
}

/**
 * Close a POS session (end of shift).
 */
export async function closePosSession(
  sessionId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<PosSession> {
  const rows = await db.query<SessionRow>(
    `UPDATE pos.pos_sessions
     SET status = 'closed', closed_at = NOW()
     WHERE id = $1 AND promoter_id = $2 AND status = 'open'
     RETURNING *`,
    [sessionId, promoterId],
  );

  if (!rows[0]) throw new Error('SESSION_NOT_FOUND: session not open or unauthorized');
  return mapSession(rows[0]);
}

/**
 * Reconcile a closed session: tally transactions and record discrepancies.
 */
export async function reconcilePos(
  sessionId: string,
  reconciledBy: string,
  expectedAmountHellers: number,
  notes: string | null,
  db: DbAdapter,
): Promise<PosReconciliation> {
  // Aggregate from transactions
  const aggRows = await db.query<{
    total_transactions: string;
    total_succeeded: string;
    total_failed: string;
    gross_amount: string;
  }>(
    `SELECT
       COUNT(*) AS total_transactions,
       COUNT(*) FILTER (WHERE status = 'succeeded') AS total_succeeded,
       COUNT(*) FILTER (WHERE status = 'failed') AS total_failed,
       COALESCE(SUM(amount_hellers) FILTER (WHERE status = 'succeeded'), 0) AS gross_amount
     FROM pos.pos_transactions
     WHERE session_id = $1`,
    [sessionId],
  );

  const agg = aggRows[0];
  const grossAmount = Number(agg.gross_amount);
  const discrepancy = grossAmount - expectedAmountHellers;

  const recRows = await db.query<ReconciliationRow>(
    `INSERT INTO pos.pos_reconciliations
       (session_id, total_transactions, total_succeeded, total_failed,
        gross_amount_hellers, net_amount_hellers, discrepancy_hellers, reconciled_by, notes)
     VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8)
     RETURNING *`,
    [
      sessionId,
      Number(agg.total_transactions),
      Number(agg.total_succeeded),
      Number(agg.total_failed),
      grossAmount,
      discrepancy,
      reconciledBy,
      notes,
    ],
  );

  // Mark session as reconciled
  await db.execute(
    `UPDATE pos.pos_sessions SET status = 'reconciled', reconciled_at = NOW() WHERE id = $1`,
    [sessionId],
  );

  return mapReconciliation(recRows[0]);
}

/**
 * Get all transactions for a session.
 */
export async function getSessionTransactions(
  sessionId: string,
  db: DbAdapter,
): Promise<PosTransaction[]> {
  const rows = await db.query<TransactionRow>(
    `SELECT * FROM pos.pos_transactions WHERE session_id = $1 ORDER BY created_at ASC`,
    [sessionId],
  );
  return rows.map(mapTransaction);
}
