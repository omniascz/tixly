// Extended CS service — global search, order detail, issue refund, reissue ticket,
// cancel order, notes on any entity, and action log audit trail.
// All monetary amounts are in haléře (integer, no floats).

import { CsError } from '../lib/cs-errors.js';
import type { CsSearchResult, CsOrderDetail } from '../types/cs.js';

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

export interface CsExtDeps {
  db: {
    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
    execute(sql: string, params?: unknown[]): Promise<void>;
    transaction<T>(fn: (tx: CsExtDeps['db']) => Promise<T>): Promise<T>;
  };
  email?: {
    sendTicketPdf(to: string, ticketId: string, barcodeCode: string, pdfBase64: string): Promise<void>;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateTotpSecret(): string {
  // Deterministic-looking random secret (32 chars base32-like).
  // In production this would use otplib or similar.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let secret = '';
  for (let i = 0; i < 32; i++) {
    secret += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return secret;
}

function generateBarcodeCode(): string {
  // 16-char hex barcode code.
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('').toUpperCase();
}

async function logCsAction(
  actionType: string,
  entityType: string,
  entityId: string,
  description: string,
  csUserId: string,
  metadata: Record<string, unknown>,
  db: CsExtDeps['db'],
): Promise<void> {
  await db.execute(
    `INSERT INTO cs.action_log (id, cs_user_id, action_type, entity_type, entity_id, description, metadata, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW())`,
    [csUserId, actionType, entityType, entityId, description, JSON.stringify(metadata)],
  );
}

// ---------------------------------------------------------------------------
// globalSearch
// ---------------------------------------------------------------------------

export async function globalSearch(query: string, deps: CsExtDeps): Promise<CsSearchResult> {
  if (!query || query.trim().length < 3) {
    throw new CsError('SEARCH_QUERY_TOO_SHORT');
  }

  const q = `%${query.trim()}%`;

  const userRows = await deps.db.query<Record<string, unknown>>(
    `SELECT
       u.id                          AS user_id,
       u.email,
       COALESCE(u.full_name, u.email) AS name,
       u.phone,
       COUNT(o.id)::int              AS order_count
     FROM auth.users u
     LEFT JOIN orders.orders o ON o.user_id = u.id
     WHERE u.email ILIKE $1
        OR u.full_name ILIKE $1
        OR u.phone ILIKE $1
     GROUP BY u.id
     ORDER BY u.email
     LIMIT 50`,
    [q],
  );

  const orderRows = await deps.db.query<Record<string, unknown>>(
    `SELECT
       o.id                    AS order_id,
       o.order_number,
       u.email                 AS buyer_email,
       e.title                 AS event_name,
       o.total_amount          AS total_halire,
       o.status
     FROM orders.orders o
     JOIN auth.users u ON u.id = o.user_id
     JOIN catalog.events e ON e.id = o.event_id
     WHERE o.order_number ILIKE $1
        OR u.email ILIKE $1
     ORDER BY o.created_at DESC
     LIMIT 50`,
    [q],
  );

  return {
    users: userRows.map(r => ({
      userId:     r['user_id'] as string,
      email:      r['email'] as string,
      name:       r['name'] as string,
      phone:      r['phone'] as string | null,
      orderCount: r['order_count'] as number,
    })),
    orders: orderRows.map(r => ({
      orderId:     r['order_id'] as string,
      orderNumber: r['order_number'] as string,
      buyerEmail:  r['buyer_email'] as string,
      eventName:   r['event_name'] as string,
      totalHalire: Number(r['total_halire']),
      status:      r['status'] as string,
    })),
  };
}

// ---------------------------------------------------------------------------
// getOrderDetail
// ---------------------------------------------------------------------------

export async function getOrderDetail(orderId: string, deps: CsExtDeps): Promise<CsOrderDetail> {
  // Order + buyer + event
  const orderRows = await deps.db.query<Record<string, unknown>>(
    `SELECT
       o.id              AS order_id,
       o.order_number,
       o.status,
       o.total_amount    AS total_halire,
       o.created_at,
       o.paid_at,
       u.id              AS user_id,
       u.email,
       COALESCE(u.full_name, u.email) AS name,
       u.phone,
       e.id              AS event_id,
       e.title           AS event_name,
       e.start_date,
       v.name            AS venue_name
     FROM orders.orders o
     JOIN auth.users u    ON u.id = o.user_id
     JOIN catalog.events e ON e.id = o.event_id
     LEFT JOIN catalog.venues v ON v.id = e.venue_id
     WHERE o.id = $1`,
    [orderId],
  );

  if (!orderRows.length) throw new CsError('ORDER_NOT_FOUND');
  const r = orderRows[0];

  // Tickets
  const ticketRows = await deps.db.query<Record<string, unknown>>(
    `SELECT
       t.id           AS ticket_id,
       tt.name        AS type_name,
       t.status,
       t.barcode_code,
       COALESCE(t.holder_name, '') AS holder_name
     FROM orders.tickets t
     LEFT JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
     WHERE t.order_id = $1
     ORDER BY t.created_at`,
    [orderId],
  );

  // Payments
  const paymentRows = await deps.db.query<Record<string, unknown>>(
    `SELECT id, provider, status, amount AS amount_halire
     FROM orders.payments
     WHERE order_id = $1
     ORDER BY created_at`,
    [orderId],
  );

  // Refunds
  const refundRows = await deps.db.query<Record<string, unknown>>(
    `SELECT id, amount AS amount_halire, status, reason, created_at
     FROM platform.refund_requests
     WHERE order_id = $1
       AND status IN ('processed', 'approved')
     ORDER BY created_at`,
    [orderId],
  );

  return {
    order: {
      id:          r['order_id'] as string,
      orderNumber: r['order_number'] as string,
      status:      r['status'] as string,
      totalHalire: Number(r['total_halire']),
      createdAt:   new Date(r['created_at'] as string),
      paidAt:      r['paid_at'] ? new Date(r['paid_at'] as string) : null,
    },
    buyer: {
      userId: r['user_id'] as string,
      email:  r['email'] as string,
      name:   r['name'] as string,
      phone:  r['phone'] as string | null,
    },
    event: {
      id:        r['event_id'] as string,
      name:      r['event_name'] as string,
      startDate: new Date(r['start_date'] as string),
      venueName: r['venue_name'] as string | null,
    },
    tickets: ticketRows.map(t => ({
      ticketId:    t['ticket_id'] as string,
      typeName:    (t['type_name'] as string) ?? 'Standard',
      status:      t['status'] as string,
      barcodeCode: t['barcode_code'] as string,
      holderName:  t['holder_name'] as string,
    })),
    payments: paymentRows.map(p => ({
      id:           p['id'] as string,
      provider:     p['provider'] as string,
      status:       p['status'] as string,
      amountHalire: Number(p['amount_halire']),
    })),
    refunds: refundRows.map(rf => ({
      id:           rf['id'] as string,
      amountHalire: Number(rf['amount_halire']),
      status:       rf['status'] as string,
      reason:       rf['reason'] as string,
      createdAt:    new Date(rf['created_at'] as string),
    })),
  };
}

// ---------------------------------------------------------------------------
// issueRefund — delegates to refund-policy via dynamic import
// ---------------------------------------------------------------------------

export async function issueRefund(
  orderId: string,
  amountHalire: number,
  reason: string,
  csUserId: string,
  deps: CsExtDeps,
): Promise<{ refundId: string }> {
  if (amountHalire <= 0) throw new CsError('INVALID_REFUND_AMOUNT');

  // Verify order exists and is refundable
  const rows = await deps.db.query<Record<string, unknown>>(
    `SELECT id, status, total_amount,
            COALESCE((SELECT SUM(amount) FROM platform.refund_requests
                       WHERE order_id=$1 AND status IN ('processed','approved')),0) AS already_refunded,
            user_id, promoter_id
     FROM orders.orders WHERE id = $1`,
    [orderId],
  );
  if (!rows.length) throw new CsError('ORDER_NOT_FOUND');

  const order = rows[0];
  const status = order['status'] as string;
  if (!['paid', 'partial_refund'].includes(status)) throw new CsError('ORDER_NOT_REFUNDABLE');

  const remaining = Number(order['total_amount']) - Number(order['already_refunded']);
  if (amountHalire > remaining) throw new CsError('INVALID_REFUND_AMOUNT');

  // Delegate to refund-policy service via direct DB insert (CS override path)
  const refundRows = await deps.db.query<Record<string, unknown>>(
    `INSERT INTO platform.refund_requests
       (order_id, ticket_id, promoter_id, user_id, reason,
        requested_amount, status, refunded_amount, refund_method,
        decided_by, decided_at, idempotency_key)
     VALUES ($1, NULL, $2, $3, $4, $5, 'approved', $5, 'original_payment', $6, NOW(),
             $7)
     RETURNING id`,
    [
      orderId,
      order['promoter_id'],
      order['user_id'],
      reason,
      amountHalire,
      csUserId,
      `cs-refund-${orderId}-${Date.now()}`,
    ],
  );

  const refundId = refundRows[0]['id'] as string;

  // Update order status
  const isFullRefund = amountHalire >= remaining;
  await deps.db.execute(
    `UPDATE orders.orders SET status = $1, updated_at = NOW() WHERE id = $2`,
    [isFullRefund ? 'refunded' : 'partial_refund', orderId],
  );

  await logCsAction(
    'refund',
    'order',
    orderId,
    `CS vrácení ${amountHalire} haléřů. Důvod: ${reason}`,
    csUserId,
    { refundId, amountHalire, reason },
    deps.db,
  );

  return { refundId };
}

// ---------------------------------------------------------------------------
// reissueTicket — generates new barcode, invalidates old, sends PDF email
// ---------------------------------------------------------------------------

export async function reissueTicket(
  ticketId: string,
  reason: string,
  csUserId: string,
  deps: CsExtDeps,
): Promise<{ newTicketId: string }> {
  const ticketRows = await deps.db.query<Record<string, unknown>>(
    `SELECT t.id, t.order_id, t.ticket_type_id, t.status, t.holder_name, t.holder_email,
            t.barcode_code,
            u.email AS buyer_email
     FROM orders.tickets t
     JOIN orders.orders o ON o.id = t.order_id
     JOIN auth.users u ON u.id = o.user_id
     WHERE t.id = $1`,
    [ticketId],
  );

  if (!ticketRows.length) throw new CsError('TICKET_NOT_FOUND');

  const ticket = ticketRows[0];
  if (ticket['status'] === 'cancelled') throw new CsError('TICKET_NOT_REISSUABLE');

  const newBarcodeCode = generateBarcodeCode();
  const newTotpSecret = generateTotpSecret();

  // Insert replacement ticket
  const newTicketRows = await deps.db.query<Record<string, unknown>>(
    `INSERT INTO orders.tickets
       (order_id, ticket_type_id, status, holder_name, holder_email,
        barcode_code, totp_secret, created_at)
     VALUES ($1, $2, 'active', $3, $4, $5, $6, NOW())
     RETURNING id`,
    [
      ticket['order_id'],
      ticket['ticket_type_id'],
      ticket['holder_name'],
      ticket['holder_email'],
      newBarcodeCode,
      newTotpSecret,
    ],
  );

  const newTicketId = newTicketRows[0]['id'] as string;

  // Invalidate old ticket
  await deps.db.execute(
    `UPDATE orders.tickets SET status = 'reissued', updated_at = NOW() WHERE id = $1`,
    [ticketId],
  );

  // Send new PDF email (fire-and-forget if email adapter available)
  const emailTo = (ticket['holder_email'] ?? ticket['buyer_email']) as string;
  if (deps.email && emailTo) {
    deps.email
      .sendTicketPdf(emailTo, newTicketId, newBarcodeCode, '')
      .catch((err: unknown) => console.error('[cs] Chyba odesílání PDF vstupenky:', err));
  }

  await logCsAction(
    'reissue_ticket',
    'ticket',
    ticketId,
    `Vstupenka ${ticketId} znovu vydána jako ${newTicketId}. Důvod: ${reason}`,
    csUserId,
    { oldTicketId: ticketId, newTicketId, reason },
    deps.db,
  );

  return { newTicketId };
}

// ---------------------------------------------------------------------------
// cancelOrder — cancel + auto-refund if paid
// ---------------------------------------------------------------------------

export async function cancelOrder(
  orderId: string,
  reason: string,
  csUserId: string,
  deps: CsExtDeps,
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const rows = await tx.query<Record<string, unknown>>(
      `SELECT id, status, total_amount, user_id, promoter_id
       FROM orders.orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    if (!rows.length) throw new CsError('ORDER_NOT_FOUND');

    const order = rows[0];
    if (order['status'] === 'cancelled') throw new CsError('ORDER_ALREADY_CANCELLED');

    await tx.execute(
      `UPDATE orders.orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [orderId],
    );
    await tx.execute(
      `UPDATE orders.tickets SET status = 'cancelled', updated_at = NOW() WHERE order_id = $1`,
      [orderId],
    );

    // Auto-refund if order was paid
    if (order['status'] === 'paid' || order['status'] === 'partial_refund') {
      const alreadyRefunded = await tx.query<Record<string, unknown>>(
        `SELECT COALESCE(SUM(amount),0) AS refunded
         FROM platform.refund_requests
         WHERE order_id = $1 AND status IN ('processed','approved')`,
        [orderId],
      );
      const totalAmount = Number(order['total_amount']);
      const alreadyRefundedAmount = Number(alreadyRefunded[0]['refunded']);
      const remaining = totalAmount - alreadyRefundedAmount;

      if (remaining > 0) {
        await tx.execute(
          `INSERT INTO platform.refund_requests
             (order_id, ticket_id, promoter_id, user_id, reason,
              requested_amount, status, refunded_amount, refund_method,
              decided_by, decided_at, idempotency_key)
           VALUES ($1, NULL, $2, $3, $4, $5, 'approved', $5, 'original_payment', $6, NOW(), $7)`,
          [
            orderId,
            order['promoter_id'],
            order['user_id'],
            reason,
            remaining,
            csUserId,
            `cs-cancel-refund-${orderId}`,
          ],
        );
      }
    }
  });

  await logCsAction(
    'cancel_order',
    'order',
    orderId,
    `Objednávka zrušena CS agentem. Důvod: ${reason}`,
    csUserId,
    { reason },
    deps.db,
  );
}

// ---------------------------------------------------------------------------
// addNote — generic entity note
// ---------------------------------------------------------------------------

export async function addNote(
  entityType: string,
  entityId: string,
  note: string,
  csUserId: string,
  deps: CsExtDeps,
): Promise<void> {
  await deps.db.execute(
    `INSERT INTO cs.notes (id, entity_type, entity_id, note, cs_user_id, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())`,
    [entityType, entityId, note, csUserId],
  );

  await logCsAction(
    'note',
    entityType,
    entityId,
    `Poznámka přidána: ${note.slice(0, 80)}`,
    csUserId,
    { note },
    deps.db,
  );
}

// ---------------------------------------------------------------------------
// getCsActionLog — paginated audit trail
// ---------------------------------------------------------------------------

export interface ActionLogFilters {
  entityType?: string;
  entityId?: string;
  csUserId?: string;
  from?: string;
  to?: string;
}

export interface Pagination {
  limit?: number;
  offset?: number;
}

export interface ActionLogItem {
  id: string;
  csUserId: string;
  actionType: string;
  entityType: string;
  entityId: string;
  description: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export async function getCsActionLog(
  filters: ActionLogFilters,
  pagination: Pagination,
  deps: CsExtDeps,
): Promise<{ items: ActionLogItem[]; total: number }> {
  const limit = pagination.limit ?? 50;
  const offset = pagination.offset ?? 0;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters.entityType) {
    conditions.push(`entity_type = $${idx++}`);
    params.push(filters.entityType);
  }
  if (filters.entityId) {
    conditions.push(`entity_id = $${idx++}`);
    params.push(filters.entityId);
  }
  if (filters.csUserId) {
    conditions.push(`cs_user_id = $${idx++}`);
    params.push(filters.csUserId);
  }
  if (filters.from) {
    conditions.push(`created_at >= $${idx++}`);
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push(`created_at <= $${idx++}`);
    params.push(filters.to);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRows = await deps.db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM cs.action_log ${where}`,
    params,
  );
  const total = parseInt(countRows[0].count, 10);

  const dataRows = await deps.db.query<Record<string, unknown>>(
    `SELECT id, cs_user_id, action_type, entity_type, entity_id,
            description, metadata, created_at
     FROM cs.action_log ${where}
     ORDER BY created_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset],
  );

  const items: ActionLogItem[] = dataRows.map(r => ({
    id:           r['id'] as string,
    csUserId:     r['cs_user_id'] as string,
    actionType:   r['action_type'] as string,
    entityType:   r['entity_type'] as string,
    entityId:     r['entity_id'] as string,
    description:  r['description'] as string,
    metadata:     (r['metadata'] as Record<string, unknown>) ?? {},
    createdAt:    new Date(r['created_at'] as string),
  }));

  return { items, total };
}
