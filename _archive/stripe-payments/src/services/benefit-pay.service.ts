// =============================================================================
// Benefit Pay Service — Czech Employee Benefit Platforms
// Feature #194: Benefit Plus, Pluxee, Gallery Beta, Benefity.cz as payment method
//
// Architecture:
//   - Injectable BenefitProviderAdapter per provider (different APIs, same interface)
//   - Session flow: initiate → user auth redirect → capture/confirm
//   - No direct card data handled — each provider redirects to their own auth UI
// =============================================================================

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

/** Injectable adapter — one implementation per benefit provider */
export interface BenefitProviderAdapter {
  /** Check employee balance. Returns null if employee not found. */
  checkBalance(employeeId: string): Promise<{ balanceCzk: number; category: string } | null>;
  /** Create a payment session. Returns redirect URL for employee auth. */
  initiatePayment(params: {
    employeeId: string;
    amountHellers: number;
    orderId: string;
    description: string;
    callbackUrl: string;
  }): Promise<{ providerSessionId: string; authUrl: string }>;
  /** Capture/confirm after employee authenticated and authorized. */
  capturePayment(providerSessionId: string): Promise<{
    providerTxId: string;
    capturedAmountHellers: number;
    status: 'success' | 'failed';
    errorCode?: string;
  }>;
  /** Refund a captured payment. */
  refundPayment(providerTxId: string, amountHellers: number): Promise<void>;
}

export type BenefitProviderId = 'benefit_plus' | 'pluxee' | 'gallery_beta' | 'benefity';

export interface BenefitPaymentSession {
  id: string;
  orderId: string;
  userId: string;
  providerId: string;
  amountHellers: number;
  currency: string;
  status: 'initiated' | 'pending_user_auth' | 'authorized' | 'captured' | 'failed' | 'refunded';
  providerSessionId: string | null;
  providerTxId: string | null;
  employeeId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  capturedAt: string | null;
}

interface SessionRow {
  id: string;
  order_id: string;
  user_id: string;
  provider_id: string;
  amount_hellers: number;
  currency: string;
  status: string;
  provider_session_id: string | null;
  provider_tx_id: string | null;
  employee_id: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  captured_at: string | null;
}

function mapSession(r: SessionRow): BenefitPaymentSession {
  return {
    id: r.id,
    orderId: r.order_id,
    userId: r.user_id,
    providerId: r.provider_id,
    amountHellers: r.amount_hellers,
    currency: r.currency,
    status: r.status as BenefitPaymentSession['status'],
    providerSessionId: r.provider_session_id,
    providerTxId: r.provider_tx_id,
    employeeId: r.employee_id,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    capturedAt: r.captured_at,
  };
}

export const SUPPORTED_PROVIDERS: BenefitProviderId[] = [
  'benefit_plus',
  'pluxee',
  'gallery_beta',
  'benefity',
];

/**
 * Initiate a benefit payment session.
 * Returns the provider's auth URL for the employee to authorize.
 */
export async function initiateBenefitPayment(
  orderId: string,
  userId: string,
  providerId: BenefitProviderId,
  employeeId: string,
  amountHellers: number,
  description: string,
  callbackUrl: string,
  provider: BenefitProviderAdapter,
  db: DbAdapter,
): Promise<{ session: BenefitPaymentSession; authUrl: string }> {
  if (!SUPPORTED_PROVIDERS.includes(providerId)) {
    throw new Error(`VALIDATION_ERROR: unsupported benefit provider '${providerId}'`);
  }
  if (amountHellers <= 0) {
    throw new Error('VALIDATION_ERROR: amount must be positive');
  }
  if (!employeeId.trim()) {
    throw new Error('VALIDATION_ERROR: employeeId is required');
  }

  // Create DB session first
  const rows = await db.query<SessionRow>(
    `INSERT INTO benefit_payments.payment_sessions
       (order_id, user_id, provider_id, amount_hellers, employee_id, status)
     VALUES ($1, $2, $3, $4, $5, 'initiated')
     RETURNING *`,
    [orderId, userId, providerId, amountHellers, employeeId],
  );

  const session = rows[0];

  try {
    const { providerSessionId, authUrl } = await provider.initiatePayment({
      employeeId,
      amountHellers,
      orderId,
      description,
      callbackUrl,
    });

    const updatedRows = await db.query<SessionRow>(
      `UPDATE benefit_payments.payment_sessions
       SET provider_session_id = $2, status = 'pending_user_auth', updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [session.id, providerSessionId],
    );

    return { session: mapSession(updatedRows[0]), authUrl };
  } catch (err) {
    await db.execute(
      `UPDATE benefit_payments.payment_sessions
       SET status = 'failed', error_message = $2, updated_at = NOW()
       WHERE id = $1`,
      [session.id, err instanceof Error ? err.message : 'INITIATE_FAILED'],
    );
    throw err;
  }
}

/**
 * Capture a payment after employee authorization.
 * Called from provider callback URL.
 */
export async function captureBenefitPayment(
  sessionId: string,
  provider: BenefitProviderAdapter,
  db: DbAdapter,
): Promise<BenefitPaymentSession> {
  const sessions = await db.query<SessionRow>(
    `SELECT * FROM benefit_payments.payment_sessions WHERE id = $1`,
    [sessionId],
  );

  if (!sessions[0]) throw new Error('SESSION_NOT_FOUND');
  const session = sessions[0];

  if (session.status !== 'pending_user_auth' && session.status !== 'authorized') {
    throw new Error(`INVALID_STATE: session is in status '${session.status}'`);
  }

  if (!session.provider_session_id) throw new Error('SESSION_NOT_INITIATED');

  const result = await provider.capturePayment(session.provider_session_id);

  if (result.status === 'failed') {
    const failedRows = await db.query<SessionRow>(
      `UPDATE benefit_payments.payment_sessions
       SET status = 'failed', error_code = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [sessionId, result.errorCode ?? 'CAPTURE_FAILED'],
    );
    return mapSession(failedRows[0]);
  }

  const capturedRows = await db.query<SessionRow>(
    `UPDATE benefit_payments.payment_sessions
     SET status = 'captured', provider_tx_id = $2, captured_at = NOW(), updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [sessionId, result.providerTxId],
  );

  return mapSession(capturedRows[0]);
}

/**
 * Get available benefit providers.
 */
export async function getAvailableProviders(
  db: DbAdapter,
): Promise<Array<{ id: string; name: string; logoUrl: string | null }>> {
  const rows = await db.query<{ id: string; name: string; logo_url: string | null }>(
    `SELECT id, name, logo_url FROM benefit_payments.providers WHERE is_active = true ORDER BY name ASC`,
    [],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, logoUrl: r.logo_url }));
}

/**
 * Check employee balance with a provider.
 */
export async function checkEmployeeBalance(
  employeeId: string,
  provider: BenefitProviderAdapter,
): Promise<{ balanceCzk: number; category: string } | null> {
  return provider.checkBalance(employeeId);
}

/**
 * Refund a captured benefit payment.
 */
export async function refundBenefitPayment(
  sessionId: string,
  provider: BenefitProviderAdapter,
  db: DbAdapter,
): Promise<BenefitPaymentSession> {
  const sessions = await db.query<SessionRow>(
    `SELECT * FROM benefit_payments.payment_sessions WHERE id = $1 AND status = 'captured'`,
    [sessionId],
  );

  if (!sessions[0]) throw new Error('SESSION_NOT_FOUND or not captured');

  await provider.refundPayment(sessions[0].provider_tx_id!, sessions[0].amount_hellers);

  const rows = await db.query<SessionRow>(
    `UPDATE benefit_payments.payment_sessions
     SET status = 'refunded', updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [sessionId],
  );

  return mapSession(rows[0]);
}
