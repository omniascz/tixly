// =============================================================================
// SERVICE: Zákaznický portál (kupec vstupenky na akci)
//
// Veškeré dotazy filtrují podle user_id v WHERE klauzuli — anti-enumerace.
// Pokud zdroj nepatří uživateli, vyhazujeme TICKET_NOT_FOUND / ORDER_NOT_FOUND
// (nikoli TICKET_NOT_OWNED — to by leakovalo existenci zdroje).
// =============================================================================

import { createHmac } from 'node:crypto';
import type { ServiceDeps } from '../lib/service-container.js';
import { BuyerPortalError } from '../lib/buyer-portal-errors.js';
import type {
  BuyerTicketSummary,
  BuyerTicketDetail,
  BuyerOrderSummary,
  BuyerOrderDetail,
  BuyerTicketStatus,
  BuyerOrderStatus,
} from '../types/buyer-portal.js';

// ---------------------------------------------------------------------------
// TOTP — RFC 6238, HMAC-SHA1, 8 digits, 30s step
// ---------------------------------------------------------------------------

const TOTP_DIGITS = 8;
const TOTP_STEP_SECONDS = 30;

/**
 * Vygeneruje aktuální 8-místný TOTP kód dle RFC 6238 z raw secret bufferu.
 * Vrací též ISO timestamp konce aktuálního 30s okna.
 */
export function generateCurrentTotp(secret: Buffer): {
  code: string;
  validUntil: string;
} {
  const nowSec = Math.floor(Date.now() / 1000);
  const counter = Math.floor(nowSec / TOTP_STEP_SECONDS);

  // Big-endian 8-byte counter
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac('sha1', secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binCode =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  const modulo = 10 ** TOTP_DIGITS;
  const code = (binCode % modulo).toString().padStart(TOTP_DIGITS, '0');

  const windowEndSec = (counter + 1) * TOTP_STEP_SECONDS;
  const validUntil = new Date(windowEndSec * 1000).toISOString();

  return { code, validUntil };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSeatInfo(
  zone: string | null,
  rowLabel: string | null,
  seatNumber: string | null,
): string | null {
  const parts: string[] = [];
  if (zone) parts.push(`Sekce ${zone}`);
  if (rowLabel) parts.push(`Řada ${rowLabel}`);
  if (seatNumber) parts.push(`Místo ${seatNumber}`);
  return parts.length > 0 ? parts.join(' / ') : null;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return new Date(value).toISOString();
  throw new BuyerPortalError('INTERNAL_ERROR', 'Neplatný formát data v DB.');
}

function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return toIso(value);
}

interface TicketRow {
  ticket_id: string;
  order_id: string;
  status: BuyerTicketStatus;
  barcode_code: string;
  short_code: string;
  holder_name: string;
  issued_at: Date | string;
  ticket_type_name: string;
  zone: string | null;
  row_label: string | null;
  seat_number: string | null;
  totp_secret_encrypted: Buffer | null;
  totp_secret_iv: Buffer | null;
  event_id: string;
  event_name: string;
  event_date: Date | string;
  venue_name: string | null;
}

function mapTicketRowToSummary(row: TicketRow): BuyerTicketSummary {
  return {
    ticketId: row.ticket_id,
    orderId: row.order_id,
    eventId: row.event_id,
    eventName: row.event_name,
    eventDate: toIso(row.event_date),
    venueName: row.venue_name ?? '',
    ticketTypeName: row.ticket_type_name,
    seatInfo: buildSeatInfo(row.zone, row.row_label, row.seat_number),
    status: row.status,
    holderName: row.holder_name,
    issuedAt: toIso(row.issued_at),
  };
}

// ---------------------------------------------------------------------------
// listBuyerTickets
// ---------------------------------------------------------------------------

const TICKET_BASE_SELECT = `
  SELECT t.id AS ticket_id,
         t.order_id,
         t.status,
         t.barcode_code,
         t.short_code,
         t.holder_name,
         t.issued_at,
         t.ticket_type_name,
         t.zone,
         t.row_label,
         t.seat_number,
         t.totp_secret_encrypted,
         t.totp_secret_iv,
         e.id   AS event_id,
         e.name AS event_name,
         e.start_date AS event_date,
         v.name AS venue_name
  FROM tickets.tickets t
  JOIN orders.orders o ON o.id = t.order_id
  JOIN catalog.events e ON e.id = o.event_id
  LEFT JOIN venues.venues v ON v.id = e.venue_id
`;

export async function listBuyerTickets(
  userId: string,
  filters: {
    status?: 'valid' | 'used' | 'cancelled' | 'refunded' | 'upcoming' | 'past';
  },
  pagination: { limit?: number; offset?: number },
  deps: ServiceDeps,
): Promise<{ items: BuyerTicketSummary[]; total: number }> {
  const limit = Math.min(Math.max(pagination.limit ?? 20, 1), 100);
  const offset = Math.max(pagination.offset ?? 0, 0);

  const params: unknown[] = [userId];
  const where: string[] = ['o.user_id = $1'];

  if (filters.status) {
    if (filters.status === 'upcoming') {
      where.push(`e.start_date >= NOW()`);
      where.push(`t.status = 'valid'`);
    } else if (filters.status === 'past') {
      where.push(`e.start_date < NOW()`);
    } else {
      params.push(filters.status);
      where.push(`t.status = $${params.length}`);
    }
  }

  const whereSql = where.join(' AND ');

  const listParams = [...params, limit, offset];
  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;

  const listSql = `
    ${TICKET_BASE_SELECT}
    WHERE ${whereSql}
    ORDER BY e.start_date DESC, t.issued_at DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const countSql = `
    SELECT COUNT(*)::int AS count
    FROM tickets.tickets t
    JOIN orders.orders o ON o.id = t.order_id
    JOIN catalog.events e ON e.id = o.event_id
    WHERE ${whereSql}
  `;

  const [rows, countRows] = await Promise.all([
    deps.db.query<TicketRow>(listSql, listParams),
    deps.db.query<{ count: number }>(countSql, params),
  ]);

  const items = rows.map(mapTicketRowToSummary);
  const total = countRows[0]?.count ?? 0;

  return { items, total };
}

// ---------------------------------------------------------------------------
// getBuyerTicketDetail
// ---------------------------------------------------------------------------

export async function getBuyerTicketDetail(
  ticketId: string,
  userId: string,
  deps: ServiceDeps,
): Promise<BuyerTicketDetail> {
  const sql = `
    ${TICKET_BASE_SELECT}
    WHERE o.user_id = $1 AND t.id = $2
    LIMIT 1
  `;

  const rows = await deps.db.query<TicketRow>(sql, [userId, ticketId]);
  const row = rows[0];

  if (!row) {
    // Anti-enumerace: nevíme, jestli vstupenka neexistuje nebo nepatří uživateli.
    throw new BuyerPortalError('TICKET_NOT_FOUND');
  }

  // Dešifrování TOTP secretu — AES-256-GCM přes @tixly/crypto.
  let secret: Buffer;
  try {
    if (!row.totp_secret_encrypted || !row.totp_secret_iv) {
      throw new Error('Chybí TOTP secret nebo IV');
    }
    // Dynamický import — modul může v testech chybět.
    const cryptoMod = await import('@tixly/crypto').catch(() => null);
    if (!cryptoMod || typeof (cryptoMod as any).decryptSecret !== 'function') {
      throw new Error('Modul @tixly/crypto není dostupný');
    }
    secret = await (cryptoMod as any).decryptSecret(
      row.totp_secret_encrypted,
      row.totp_secret_iv,
      ticketId,
    );
  } catch (err) {
    throw new BuyerPortalError(
      'INTERNAL_ERROR',
      `Nepodařilo se dešifrovat TOTP secret pro vstupenku ${ticketId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const { code: totpCode, validUntil: totpValidUntil } = generateCurrentTotp(secret);

  const summary = mapTicketRowToSummary(row);

  return {
    ...summary,
    barcodeCode: row.barcode_code,
    shortCode: row.short_code,
    totpCode,
    totpValidUntil,
    pdfDownloadUrl: `/api/portal/me/tickets/${row.ticket_id}/pdf`,
  };
}

// ---------------------------------------------------------------------------
// listBuyerOrders
// ---------------------------------------------------------------------------

interface OrderRow {
  order_id: string;
  created_at: Date | string;
  status: BuyerOrderStatus;
  total_amount_halire: number;
  subtotal_halire: number;
  fees_halire: number;
  refunded_amount_halire: number | null;
  paid_at: Date | string | null;
  ticket_count: number;
  event_name: string | null;
  distinct_event_count: number;
}

const ORDER_BASE_SELECT = `
  SELECT o.id AS order_id,
         o.created_at,
         o.status,
         o.total_amount_halire,
         o.subtotal_halire,
         o.fees_halire,
         o.refunded_amount_halire,
         o.paid_at,
         (SELECT COUNT(*)::int FROM tickets.tickets t WHERE t.order_id = o.id) AS ticket_count,
         (SELECT e.name FROM catalog.events e WHERE e.id = o.event_id)         AS event_name,
         (SELECT COUNT(DISTINCT oi.event_id)::int
            FROM orders.order_items oi WHERE oi.order_id = o.id)               AS distinct_event_count
  FROM orders.orders o
`;

function mapOrderRowToSummary(row: OrderRow): BuyerOrderSummary {
  return {
    orderId: row.order_id,
    createdAt: toIso(row.created_at),
    status: row.status,
    totalAmountHalire: row.total_amount_halire,
    ticketCount: row.ticket_count,
    eventName:
      row.distinct_event_count > 1 ? 'multiple' : row.event_name ?? 'multiple',
    paidAt: toIsoOrNull(row.paid_at),
  };
}

export async function listBuyerOrders(
  userId: string,
  pagination: { limit?: number; offset?: number },
  deps: ServiceDeps,
): Promise<{ items: BuyerOrderSummary[]; total: number }> {
  const limit = Math.min(Math.max(pagination.limit ?? 20, 1), 100);
  const offset = Math.max(pagination.offset ?? 0, 0);

  const listSql = `
    ${ORDER_BASE_SELECT}
    WHERE o.user_id = $1
    ORDER BY o.created_at DESC
    LIMIT $2 OFFSET $3
  `;
  const countSql = `
    SELECT COUNT(*)::int AS count FROM orders.orders WHERE user_id = $1
  `;

  const [rows, countRows] = await Promise.all([
    deps.db.query<OrderRow>(listSql, [userId, limit, offset]),
    deps.db.query<{ count: number }>(countSql, [userId]),
  ]);

  return {
    items: rows.map(mapOrderRowToSummary),
    total: countRows[0]?.count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// getBuyerOrderDetail
// ---------------------------------------------------------------------------

export async function getBuyerOrderDetail(
  orderId: string,
  userId: string,
  deps: ServiceDeps,
): Promise<BuyerOrderDetail> {
  const orderSql = `
    ${ORDER_BASE_SELECT}
    WHERE o.user_id = $1 AND o.id = $2
    LIMIT 1
  `;

  const orderRows = await deps.db.query<OrderRow>(orderSql, [userId, orderId]);
  const orderRow = orderRows[0];

  if (!orderRow) {
    // Anti-enumerace.
    throw new BuyerPortalError('ORDER_NOT_FOUND');
  }

  const ticketsSql = `
    ${TICKET_BASE_SELECT}
    WHERE o.user_id = $1 AND o.id = $2
    ORDER BY t.issued_at ASC
  `;
  const ticketRows = await deps.db.query<TicketRow>(ticketsSql, [userId, orderId]);

  const summary = mapOrderRowToSummary(orderRow);

  return {
    ...summary,
    tickets: ticketRows.map(mapTicketRowToSummary),
    subtotalHalire: orderRow.subtotal_halire,
    feesHalire: orderRow.fees_halire,
    refundedAmountHalire: orderRow.refunded_amount_halire,
  };
}
