// =============================================================================
// B2B Invoice Purchase Service
// Feature #182: Corporate ticket purchase flow:
//              reserve → proforma invoice → email → auto-cancel if unpaid
//
// Flow:
//   1. createInvoiceOrder — reserve tickets, generate proforma
//   2. confirmOrder — locks order, sets due date, sends proforma
//   3. markAsPaid — record payment, release tickets to buyer
//   4. cancelOverdueOrders — cron job: auto-cancel past-due unpaid orders
// =============================================================================

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

/** Injectable — generates proforma PDF URL (S3, local storage, etc.) */
export interface ProformaGenerator {
  generate(order: InvoiceOrder): Promise<string>;
}

/** Injectable — sends proforma to contact email */
export interface EmailSender {
  sendProforma(order: InvoiceOrder, pdfUrl: string): Promise<void>;
}

export type InvoiceOrderStatus =
  | 'draft'
  | 'confirmed'
  | 'proforma_sent'
  | 'paid'
  | 'cancelled'
  | 'overdue';

export interface TicketItem {
  ticketTypeId: string;
  qty: number;
  unitPriceHellers: number;
}

export interface InvoiceOrder {
  id: string;
  promoterId: string;
  eventId: string;
  companyName: string;
  companyIco: string;
  companyAddress: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  invoiceNumber: string | null;
  ticketItems: TicketItem[];
  totalAmountHellers: number;
  vatAmountHellers: number;
  currency: string;
  paymentDueDays: number;
  dueDate: string | null;
  status: InvoiceOrderStatus;
  proformaPdfUrl: string | null;
  paymentReference: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface OrderRow {
  id: string;
  promoter_id: string;
  event_id: string;
  company_name: string;
  company_ico: string;
  company_address: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  invoice_number: string | null;
  ticket_items: TicketItem[];
  total_amount_hellers: string;
  vat_amount_hellers: string;
  currency: string;
  payment_due_days: number;
  due_date: string | null;
  status: string;
  proforma_pdf_url: string | null;
  payment_reference: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapOrder(r: OrderRow): InvoiceOrder {
  return {
    id: r.id,
    promoterId: r.promoter_id,
    eventId: r.event_id,
    companyName: r.company_name,
    companyIco: r.company_ico,
    companyAddress: r.company_address,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    contactPhone: r.contact_phone,
    invoiceNumber: r.invoice_number,
    ticketItems: r.ticket_items,
    totalAmountHellers: Number(r.total_amount_hellers),
    vatAmountHellers: Number(r.vat_amount_hellers),
    currency: r.currency,
    paymentDueDays: r.payment_due_days,
    dueDate: r.due_date,
    status: r.status as InvoiceOrderStatus,
    proformaPdfUrl: r.proforma_pdf_url,
    paymentReference: r.payment_reference,
    paidAt: r.paid_at,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
    confirmedAt: r.confirmed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function generateInvoiceNumber(): string {
  const now = new Date();
  const year = now.getFullYear();
  const seq = Date.now().toString().slice(-6);
  return `B2B-${year}-${seq}`;
}

function generatePaymentReference(): string {
  // VS symbol: numeric, max 10 digits
  return String(Date.now()).slice(-10);
}

/**
 * Create a new B2B invoice order (draft status).
 * Validates items and computes totals — does NOT yet reserve inventory.
 */
export async function createInvoiceOrder(
  input: {
    promoterId: string;
    eventId: string;
    companyName: string;
    companyIco: string;
    companyAddress: string;
    contactName: string;
    contactEmail: string;
    contactPhone?: string;
    ticketItems: TicketItem[];
    vatAmountHellers?: number;
    currency?: string;
    paymentDueDays?: number;
  },
  db: DbAdapter,
): Promise<InvoiceOrder> {
  if (!input.companyName.trim()) throw new Error('VALIDATION_ERROR: companyName is required');
  if (!input.companyIco.trim()) throw new Error('VALIDATION_ERROR: companyIco is required');
  if (!input.contactEmail.includes('@')) throw new Error('VALIDATION_ERROR: invalid email');
  if (input.ticketItems.length === 0) throw new Error('VALIDATION_ERROR: at least one ticket item is required');

  for (const item of input.ticketItems) {
    if (item.qty <= 0) throw new Error('VALIDATION_ERROR: ticket item qty must be positive');
    if (item.unitPriceHellers <= 0) throw new Error('VALIDATION_ERROR: ticket item price must be positive');
  }

  const totalAmountHellers = input.ticketItems.reduce(
    (sum, item) => sum + item.qty * item.unitPriceHellers,
    0,
  );

  const paymentDueDays = input.paymentDueDays ?? 14;
  if (paymentDueDays < 1 || paymentDueDays > 90) {
    throw new Error('VALIDATION_ERROR: paymentDueDays must be between 1 and 90');
  }

  const rows = await db.query<OrderRow>(
    `INSERT INTO b2b_orders.invoice_orders
       (promoter_id, event_id, company_name, company_ico, company_address,
        contact_name, contact_email, contact_phone, ticket_items,
        total_amount_hellers, vat_amount_hellers, currency, payment_due_days)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13)
     RETURNING *`,
    [
      input.promoterId,
      input.eventId,
      input.companyName,
      input.companyIco,
      input.companyAddress,
      input.contactName,
      input.contactEmail,
      input.contactPhone ?? null,
      JSON.stringify(input.ticketItems),
      totalAmountHellers,
      input.vatAmountHellers ?? 0,
      input.currency ?? 'CZK',
      paymentDueDays,
    ],
  );

  return mapOrder(rows[0]);
}

/**
 * Confirm order: reserves inventory, generates proforma PDF, sends email.
 * Transitions draft → confirmed → proforma_sent.
 */
export async function confirmOrder(
  orderId: string,
  promoterId: string,
  proformaGenerator: ProformaGenerator,
  emailSender: EmailSender,
  db: DbAdapter,
): Promise<InvoiceOrder> {
  const orders = await db.query<OrderRow>(
    `SELECT * FROM b2b_orders.invoice_orders WHERE id = $1 AND promoter_id = $2`,
    [orderId, promoterId],
  );

  if (!orders[0]) throw new Error('ORDER_NOT_FOUND');
  if (orders[0].status !== 'draft') throw new Error(`INVALID_STATE: order is '${orders[0].status}'`);

  const invoiceNumber = generateInvoiceNumber();
  const paymentReference = generatePaymentReference();

  // Reserve inventory for each ticket item
  const order = mapOrder(orders[0]);
  for (const item of order.ticketItems) {
    await db.query<{ id: string }>(
      `INSERT INTO b2b_orders.order_reservations (order_id, ticket_type_id, quantity)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [orderId, item.ticketTypeId, item.qty],
    );
  }

  // Mark as confirmed, set due date
  const confirmedRows = await db.query<OrderRow>(
    `UPDATE b2b_orders.invoice_orders
     SET status = 'confirmed',
         invoice_number = $2,
         payment_reference = $3,
         confirmed_at = NOW(),
         due_date = (NOW() + (payment_due_days || ' days')::interval)::date,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [orderId, invoiceNumber, paymentReference],
  );

  const confirmedOrder = mapOrder(confirmedRows[0]);

  // Generate proforma PDF
  const pdfUrl = await proformaGenerator.generate(confirmedOrder);

  // Update with PDF URL and mark proforma_sent
  const sentRows = await db.query<OrderRow>(
    `UPDATE b2b_orders.invoice_orders
     SET status = 'proforma_sent', proforma_pdf_url = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [orderId, pdfUrl],
  );

  const sentOrder = mapOrder(sentRows[0]);

  // Send email (best-effort: don't fail the order if email fails)
  try {
    await emailSender.sendProforma(sentOrder, pdfUrl);
  } catch {
    // Email failure is logged externally — order status stays proforma_sent
  }

  return sentOrder;
}

/**
 * Mark an order as paid (triggered by bank transfer matching or manual confirmation).
 */
export async function markAsPaid(
  orderId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<InvoiceOrder> {
  const rows = await db.query<OrderRow>(
    `UPDATE b2b_orders.invoice_orders
     SET status = 'paid', paid_at = NOW(), updated_at = NOW()
     WHERE id = $1
       AND promoter_id = $2
       AND status IN ('confirmed', 'proforma_sent')
     RETURNING *`,
    [orderId, promoterId],
  );

  if (!rows[0]) throw new Error('ORDER_NOT_FOUND or not in payable state');
  return mapOrder(rows[0]);
}

/**
 * Cancel an order manually.
 * Releases reserved inventory.
 */
export async function cancelOrder(
  orderId: string,
  promoterId: string,
  cancelReason: string,
  db: DbAdapter,
): Promise<InvoiceOrder> {
  const orders = await db.query<OrderRow>(
    `SELECT * FROM b2b_orders.invoice_orders WHERE id = $1 AND promoter_id = $2`,
    [orderId, promoterId],
  );

  if (!orders[0]) throw new Error('ORDER_NOT_FOUND');
  if (orders[0].status === 'paid') throw new Error('INVALID_STATE: cannot cancel a paid order');
  if (orders[0].status === 'cancelled') throw new Error('INVALID_STATE: order already cancelled');

  // Release reservations
  await db.execute(
    `UPDATE b2b_orders.order_reservations
     SET released_at = NOW()
     WHERE order_id = $1 AND released_at IS NULL`,
    [orderId],
  );

  await db.execute(
    `INSERT INTO b2b_orders.dunning_log (order_id, action, notes)
     VALUES ($1, 'manual_cancel', $2)`,
    [orderId, cancelReason],
  );

  const rows = await db.query<OrderRow>(
    `UPDATE b2b_orders.invoice_orders
     SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [orderId, cancelReason],
  );

  return mapOrder(rows[0]);
}

/**
 * Cron job: auto-cancel overdue unpaid orders.
 * Returns the list of order IDs that were cancelled.
 */
export async function cancelOverdueOrders(db: DbAdapter): Promise<string[]> {
  // Mark confirmed/proforma_sent orders past due date as overdue first
  const overdueRows = await db.query<OrderRow>(
    `UPDATE b2b_orders.invoice_orders
     SET status = 'overdue', updated_at = NOW()
     WHERE status IN ('confirmed', 'proforma_sent')
       AND due_date < CURRENT_DATE
     RETURNING *`,
    [],
  );

  for (const order of overdueRows) {
    await db.execute(
      `INSERT INTO b2b_orders.dunning_log (order_id, action) VALUES ($1, 'overdue_marked')`,
      [order.id],
    );
  }

  // Now auto-cancel overdue orders (overdue for more than 7 days grace period)
  const cancelledRows = await db.query<OrderRow>(
    `UPDATE b2b_orders.invoice_orders
     SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = 'AUTO_CANCELLED_OVERDUE', updated_at = NOW()
     WHERE status = 'overdue'
       AND due_date < CURRENT_DATE - INTERVAL '7 days'
     RETURNING *`,
    [],
  );

  for (const order of cancelledRows) {
    // Release reservations
    await db.execute(
      `UPDATE b2b_orders.order_reservations
       SET released_at = NOW()
       WHERE order_id = $1 AND released_at IS NULL`,
      [order.id],
    );

    await db.execute(
      `INSERT INTO b2b_orders.dunning_log (order_id, action, notes)
       VALUES ($1, 'auto_cancelled', 'Past 7-day grace period')`,
      [order.id],
    );
  }

  return cancelledRows.map((r) => r.id);
}

/**
 * List B2B orders for a promoter. Optionally filter by status.
 */
export async function listInvoiceOrders(
  promoterId: string,
  eventId: string | null,
  status: InvoiceOrderStatus | null,
  db: DbAdapter,
): Promise<InvoiceOrder[]> {
  const rows = await db.query<OrderRow>(
    `SELECT * FROM b2b_orders.invoice_orders
     WHERE promoter_id = $1
       AND ($2::uuid IS NULL OR event_id = $2)
       AND ($3::text IS NULL OR status = $3)
     ORDER BY created_at DESC`,
    [promoterId, eventId, status],
  );
  return rows.map(mapOrder);
}

/**
 * Get a single order (promoter-scoped).
 */
export async function getInvoiceOrder(
  orderId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<InvoiceOrder | null> {
  const rows = await db.query<OrderRow>(
    `SELECT * FROM b2b_orders.invoice_orders WHERE id = $1 AND promoter_id = $2`,
    [orderId, promoterId],
  );
  return rows[0] ? mapOrder(rows[0]) : null;
}
