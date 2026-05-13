// =============================================================================
// PayPal Service — PayPal Payment Integration
// Feature #181: PayPal for foreign buyers (AT/DE border events, corporate)
//
// Uses injectable PayPalAdapter — keeps core service testable without
// live PayPal API calls. Adapter wraps PayPal Orders API v2.
//
// Flow:
//   1. createPayPalOrder — server creates order, returns approvalUrl
//   2. Buyer approves in PayPal UI (redirect or popup)
//   3. capturePayPalOrder — server captures after buyer approval
//   4. refundPayPalOrder — on return/cancellation
// =============================================================================

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

/** Injectable adapter — wraps PayPal Orders API v2 */
export interface PayPalAdapter {
  /** Create a PayPal order. Returns PayPal order ID and buyer approval URL. */
  createOrder(params: {
    amountHellers: number;
    currency: string;
    returnUrl: string;
    cancelUrl: string;
    description: string;
  }): Promise<{ paypalOrderId: string; approvalUrl: string }>;

  /** Capture an approved PayPal order. */
  captureOrder(paypalOrderId: string): Promise<{
    captureId: string;
    status: 'completed' | 'declined' | 'failed';
    payerEmail: string | null;
    payerName: string | null;
  }>;

  /** Refund a captured payment. */
  refundCapture(captureId: string, amountHellers: number): Promise<void>;
}

export type PayPalOrderStatus =
  | 'created'
  | 'approved'
  | 'captured'
  | 'failed'
  | 'refunded'
  | 'cancelled';

export interface PayPalOrder {
  id: string;
  orderId: string;
  userId: string;
  paypalOrderId: string;
  amountHellers: number;
  currency: string;
  status: PayPalOrderStatus;
  paypalCaptureId: string | null;
  payerEmail: string | null;
  payerName: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  capturedAt: string | null;
}

interface OrderRow {
  id: string;
  order_id: string;
  user_id: string;
  paypal_order_id: string;
  amount_hellers: string;
  currency: string;
  status: string;
  paypal_capture_id: string | null;
  payer_email: string | null;
  payer_name: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  captured_at: string | null;
}

function mapOrder(r: OrderRow): PayPalOrder {
  return {
    id: r.id,
    orderId: r.order_id,
    userId: r.user_id,
    paypalOrderId: r.paypal_order_id,
    amountHellers: Number(r.amount_hellers),
    currency: r.currency,
    status: r.status as PayPalOrderStatus,
    paypalCaptureId: r.paypal_capture_id,
    payerEmail: r.payer_email,
    payerName: r.payer_name,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    capturedAt: r.captured_at,
  };
}

/**
 * Create a PayPal order for checkout.
 * Returns the buyer approval URL to redirect to.
 */
export async function createPayPalOrder(
  input: {
    orderId: string;
    userId: string;
    amountHellers: number;
    currency?: string;
    description: string;
    returnUrl: string;
    cancelUrl: string;
  },
  adapter: PayPalAdapter,
  db: DbAdapter,
): Promise<{ paypalOrder: PayPalOrder; approvalUrl: string }> {
  if (input.amountHellers <= 0) throw new Error('VALIDATION_ERROR: amountHellers must be positive');
  if (!input.description.trim()) throw new Error('VALIDATION_ERROR: description is required');

  const currency = input.currency ?? 'CZK';

  const { paypalOrderId, approvalUrl } = await adapter.createOrder({
    amountHellers: input.amountHellers,
    currency,
    returnUrl: input.returnUrl,
    cancelUrl: input.cancelUrl,
    description: input.description,
  });

  const rows = await db.query<OrderRow>(
    `INSERT INTO payments.paypal_orders
       (order_id, user_id, paypal_order_id, amount_hellers, currency, status)
     VALUES ($1, $2, $3, $4, $5, 'created')
     RETURNING *`,
    [input.orderId, input.userId, paypalOrderId, input.amountHellers, currency],
  );

  return { paypalOrder: mapOrder(rows[0]), approvalUrl };
}

/**
 * Capture an approved PayPal order (called after buyer returns from PayPal).
 */
export async function capturePayPalOrder(
  paypalOrderId: string,
  adapter: PayPalAdapter,
  db: DbAdapter,
): Promise<PayPalOrder> {
  const existing = await db.query<OrderRow>(
    `SELECT * FROM payments.paypal_orders WHERE paypal_order_id = $1`,
    [paypalOrderId],
  );

  if (!existing[0]) throw new Error('PAYPAL_ORDER_NOT_FOUND');
  if (!['created', 'approved'].includes(existing[0].status)) {
    throw new Error(`INVALID_STATE: order is '${existing[0].status}'`);
  }

  try {
    const result = await adapter.captureOrder(paypalOrderId);

    if (result.status !== 'completed') {
      const failedRows = await db.query<OrderRow>(
        `UPDATE payments.paypal_orders
         SET status = 'failed', error_code = $2, updated_at = NOW()
         WHERE paypal_order_id = $1
         RETURNING *`,
        [paypalOrderId, result.status.toUpperCase()],
      );
      return mapOrder(failedRows[0]);
    }

    const rows = await db.query<OrderRow>(
      `UPDATE payments.paypal_orders
       SET status = 'captured',
           paypal_capture_id = $2,
           payer_email = $3,
           payer_name = $4,
           captured_at = NOW(),
           updated_at = NOW()
       WHERE paypal_order_id = $1
       RETURNING *`,
      [paypalOrderId, result.captureId, result.payerEmail, result.payerName],
    );

    return mapOrder(rows[0]);
  } catch (err) {
    await db.execute(
      `UPDATE payments.paypal_orders
       SET status = 'failed', error_message = $2, updated_at = NOW()
       WHERE paypal_order_id = $1`,
      [paypalOrderId, err instanceof Error ? err.message : 'CAPTURE_FAILED'],
    );
    throw err;
  }
}

/**
 * Refund a captured PayPal payment.
 */
export async function refundPayPalOrder(
  paypalOrderId: string,
  adapter: PayPalAdapter,
  db: DbAdapter,
): Promise<PayPalOrder> {
  const rows = await db.query<OrderRow>(
    `SELECT * FROM payments.paypal_orders WHERE paypal_order_id = $1 AND status = 'captured'`,
    [paypalOrderId],
  );

  if (!rows[0]) throw new Error('PAYPAL_ORDER_NOT_FOUND or not captured');

  await adapter.refundCapture(rows[0].paypal_capture_id!, Number(rows[0].amount_hellers));

  const refunded = await db.query<OrderRow>(
    `UPDATE payments.paypal_orders
     SET status = 'refunded', updated_at = NOW()
     WHERE paypal_order_id = $1
     RETURNING *`,
    [paypalOrderId],
  );

  return mapOrder(refunded[0]);
}

/**
 * Get PayPal order status (e.g. after buyer returns from redirect).
 */
export async function getPayPalOrder(
  paypalOrderId: string,
  db: DbAdapter,
): Promise<PayPalOrder | null> {
  const rows = await db.query<OrderRow>(
    `SELECT * FROM payments.paypal_orders WHERE paypal_order_id = $1`,
    [paypalOrderId],
  );
  return rows[0] ? mapOrder(rows[0]) : null;
}
