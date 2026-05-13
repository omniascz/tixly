import { CsError } from '../lib/cs-errors';

export interface CsDeps {
  db: {
    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
    execute(sql: string, params?: unknown[]): Promise<void>;
    transaction<T>(fn: (tx: CsDeps['db']) => Promise<T>): Promise<T>;
  };
}

// ---- Types ----

export interface OrderDetail {
  orderId: string;
  userId: string;
  status: string;           // pending|paid|cancelled|refunded|partial_refund
  totalAmount: number;
  currency: string;
  paymentProvider: string;
  createdAt: string;
  eventId: string;
  eventTitle: string;
  ticketCount: number;
  refundedAmount: number;
}

export interface TicketRow {
  ticketId: string;
  orderId: string;
  holderName: string | null;
  holderEmail: string | null;
  status: string;
  transferredAt: string | null;
  transferredTo: string | null;
}

export interface CustomerProfile {
  userId: string;
  email: string;
  createdAt: string;
  orderCount: number;
  totalSpent: number;
  orders: Array<{
    orderId: string;
    status: string;
    totalAmount: number;
    createdAt: string;
    eventTitle: string;
  }>;
}

// ---- getOrder ----

export async function getOrder(orderId: string, deps: CsDeps): Promise<OrderDetail> {
  const rows = await deps.db.query<Record<string, unknown>>(
    `SELECT
       o.id            AS order_id,
       o.user_id,
       o.status,
       o.total_amount,
       o.currency,
       o.payment_provider,
       o.created_at,
       e.id            AS event_id,
       e.title         AS event_title,
       COUNT(t.id)     AS ticket_count,
       COALESCE(SUM(CASE WHEN pr.status='succeeded' THEN pr.amount ELSE 0 END),0) AS refunded_amount
     FROM orders.orders o
     JOIN catalog.events e ON e.id = o.event_id
     LEFT JOIN orders.tickets t ON t.order_id = o.id
     LEFT JOIN orders.payment_events pr ON pr.order_id = o.id AND pr.event_type='refunded'
     WHERE o.id = $1
     GROUP BY o.id, e.id, e.title`,
    [orderId],
  );
  if (!rows.length) throw new CsError('ORDER_NOT_FOUND');
  const r = rows[0];
  return {
    orderId:         r['order_id'] as string,
    userId:          r['user_id'] as string,
    status:          r['status'] as string,
    totalAmount:     Number(r['total_amount']),
    currency:        r['currency'] as string,
    paymentProvider: r['payment_provider'] as string,
    createdAt:       r['created_at'] as string,
    eventId:         r['event_id'] as string,
    eventTitle:      r['event_title'] as string,
    ticketCount:     Number(r['ticket_count']),
    refundedAmount:  Number(r['refunded_amount']),
  };
}

// ---- listTicketsForOrder ----

export async function listTicketsForOrder(orderId: string, deps: CsDeps): Promise<TicketRow[]> {
  // verify order exists
  const order = await getOrder(orderId, deps);  // throws ORDER_NOT_FOUND if missing
  void order;
  const rows = await deps.db.query<Record<string, unknown>>(
    `SELECT id AS ticket_id, order_id, holder_name, holder_email, status,
            transferred_at, transferred_to
     FROM orders.tickets
     WHERE order_id = $1
     ORDER BY created_at`,
    [orderId],
  );
  return rows.map(r => ({
    ticketId:       r['ticket_id'] as string,
    orderId:        r['order_id'] as string,
    holderName:     r['holder_name'] as string | null,
    holderEmail:    r['holder_email'] as string | null,
    status:         r['status'] as string,
    transferredAt:  r['transferred_at'] as string | null,
    transferredTo:  r['transferred_to'] as string | null,
  }));
}

// ---- refundOrder ----

export interface RefundInput {
  amount?: number;   // partial; if omitted → full refund
  reason: string;
  agentId: string;
}

export async function refundOrder(orderId: string, input: RefundInput, deps: CsDeps): Promise<OrderDetail> {
  return deps.db.transaction(async (tx) => {
    const rows = await tx.query<Record<string, unknown>>(
      `SELECT id, status, total_amount, currency,
              COALESCE((SELECT SUM(amount) FROM orders.payment_events WHERE order_id=$1 AND event_type='refunded'),0) AS refunded_amount
       FROM orders.orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    if (!rows.length) throw new CsError('ORDER_NOT_FOUND');
    const order = rows[0];
    const status = order['status'] as string;
    if (status === 'cancelled') throw new CsError('ORDER_ALREADY_CANCELLED');
    if (!['paid', 'partial_refund'].includes(status)) throw new CsError('ORDER_NOT_REFUNDABLE');

    const totalAmount = Number(order['total_amount']);
    const alreadyRefunded = Number(order['refunded_amount']);
    const remaining = totalAmount - alreadyRefunded;
    const refundAmount = input.amount ?? remaining;

    if (refundAmount > remaining) throw new CsError('INVALID_REFUND_AMOUNT');

    const isFullRefund = refundAmount >= remaining;
    const newStatus = isFullRefund ? 'refunded' : 'partial_refund';

    await tx.execute(
      `UPDATE orders.orders SET status = $1, updated_at = NOW() WHERE id = $2`,
      [newStatus, orderId],
    );
    await tx.execute(
      `INSERT INTO orders.payment_events (order_id, event_type, amount, metadata)
       VALUES ($1, 'refunded', $2, $3)`,
      [orderId, refundAmount, JSON.stringify({ reason: input.reason, agentId: input.agentId })],
    );
    await tx.execute(
      `INSERT INTO orders.cs_notes (order_id, agent_id, note, action)
       VALUES ($1, $2, $3, 'refund')`,
      [orderId, input.agentId, `Refund ${refundAmount} ${order['currency']}: ${input.reason}`],
    );

    // Return updated order
    const updated = await tx.query<Record<string, unknown>>(
      `SELECT o.id AS order_id, o.user_id, o.status, o.total_amount, o.currency,
              o.payment_provider, o.created_at,
              e.id AS event_id, e.title AS event_title,
              COUNT(t.id) AS ticket_count, $1 AS refunded_amount
       FROM orders.orders o
       JOIN catalog.events e ON e.id = o.event_id
       LEFT JOIN orders.tickets t ON t.order_id = o.id
       WHERE o.id = $2
       GROUP BY o.id, e.id, e.title`,
      [alreadyRefunded + refundAmount, orderId],
    );
    const u = updated[0];
    return {
      orderId:         u['order_id'] as string,
      userId:          u['user_id'] as string,
      status:          u['status'] as string,
      totalAmount:     Number(u['total_amount']),
      currency:        u['currency'] as string,
      paymentProvider: u['payment_provider'] as string,
      createdAt:       u['created_at'] as string,
      eventId:         u['event_id'] as string,
      eventTitle:      u['event_title'] as string,
      ticketCount:     Number(u['ticket_count']),
      refundedAmount:  alreadyRefunded + refundAmount,
    };
  });
}

// ---- cancelOrder ----

export async function cancelOrder(orderId: string, reason: string, agentId: string, deps: CsDeps): Promise<void> {
  const rows = await deps.db.query<Record<string, unknown>>(
    `SELECT status FROM orders.orders WHERE id = $1`,
    [orderId],
  );
  if (!rows.length) throw new CsError('ORDER_NOT_FOUND');
  if (rows[0]['status'] === 'cancelled') throw new CsError('ORDER_ALREADY_CANCELLED');

  await deps.db.execute(
    `UPDATE orders.orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
    [orderId],
  );
  await deps.db.execute(
    `UPDATE orders.tickets SET status = 'cancelled' WHERE order_id = $1`,
    [orderId],
  );
  await deps.db.execute(
    `INSERT INTO orders.cs_notes (order_id, agent_id, note, action)
     VALUES ($1, $2, $3, 'cancel')`,
    [orderId, agentId, reason],
  );
}

// ---- addNote ----

export async function addNote(orderId: string, note: string, agentId: string, deps: CsDeps): Promise<void> {
  const rows = await deps.db.query<Record<string, unknown>>(
    `SELECT id FROM orders.orders WHERE id = $1`,
    [orderId],
  );
  if (!rows.length) throw new CsError('ORDER_NOT_FOUND');
  await deps.db.execute(
    `INSERT INTO orders.cs_notes (order_id, agent_id, note, action)
     VALUES ($1, $2, $3, 'note')`,
    [orderId, agentId, note],
  );
}

// ---- transferTicket ----

export interface TransferInput {
  toEmail: string;
  toName?: string;
  reason?: string;
  agentId: string;
}

export async function transferTicket(ticketId: string, input: TransferInput, deps: CsDeps): Promise<TicketRow> {
  const rows = await deps.db.query<Record<string, unknown>>(
    `SELECT id AS ticket_id, order_id, holder_name, holder_email, status,
            transferred_at, transferred_to
     FROM orders.tickets WHERE id = $1`,
    [ticketId],
  );
  if (!rows.length) throw new CsError('TICKET_NOT_FOUND');
  const ticket = rows[0];
  if (ticket['transferred_at'] !== null) throw new CsError('TICKET_ALREADY_TRANSFERRED');
  if (ticket['status'] === 'cancelled') throw new CsError('ORDER_ALREADY_CANCELLED');

  await deps.db.execute(
    `UPDATE orders.tickets
     SET holder_name = $1, holder_email = $2,
         transferred_at = NOW(), transferred_to = $2,
         status = 'transferred'
     WHERE id = $3`,
    [input.toName ?? ticket['holder_name'], input.toEmail, ticketId],
  );
  await deps.db.execute(
    `INSERT INTO orders.cs_notes (order_id, agent_id, note, action)
     VALUES ($1, $2, $3, 'transfer')`,
    [ticket['order_id'], input.agentId, `Ticket ${ticketId} transferred to ${input.toEmail}. ${input.reason ?? ''}`],
  );

  return {
    ticketId:      ticketId,
    orderId:       ticket['order_id'] as string,
    holderName:    input.toName ?? ticket['holder_name'] as string | null,
    holderEmail:   input.toEmail,
    status:        'transferred',
    transferredAt: new Date().toISOString(),
    transferredTo: input.toEmail,
  };
}

// ---- getCustomer ----

export async function getCustomer(userId: string, deps: CsDeps): Promise<CustomerProfile> {
  const userRows = await deps.db.query<Record<string, unknown>>(
    `SELECT id AS user_id, email, created_at FROM auth.users WHERE id = $1`,
    [userId],
  );
  if (!userRows.length) throw new CsError('CUSTOMER_NOT_FOUND');

  const orderRows = await deps.db.query<Record<string, unknown>>(
    `SELECT o.id AS order_id, o.status, o.total_amount, o.created_at, e.title AS event_title
     FROM orders.orders o
     JOIN catalog.events e ON e.id = o.event_id
     WHERE o.user_id = $1
     ORDER BY o.created_at DESC
     LIMIT 50`,
    [userId],
  );

  const orders = orderRows.map(r => ({
    orderId:     r['order_id'] as string,
    status:      r['status'] as string,
    totalAmount: Number(r['total_amount']),
    createdAt:   r['created_at'] as string,
    eventTitle:  r['event_title'] as string,
  }));

  const paidOrders = orders.filter(o => ['paid', 'refunded', 'partial_refund'].includes(o.status));
  const totalSpent = paidOrders.reduce((sum, o) => sum + o.totalAmount, 0);

  return {
    userId:     userRows[0]['user_id'] as string,
    email:      userRows[0]['email'] as string,
    createdAt:  userRows[0]['created_at'] as string,
    orderCount: orders.length,
    totalSpent,
    orders,
  };
}
