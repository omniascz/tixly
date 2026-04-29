/**
 * PostgreSQL implementace DbAdapter pro produkční použití.
 *
 * Závislost: pg (node-postgres) — přidat do package.json:
 *   "pg": "^8.11.0", "@types/pg": "^8.11.0"
 *
 * SQL dotazy používají parametrizované vstupy (ochrana před SQL injection).
 * Všechny cross-schema JOINy jsou vyjádřeny plně kvalifikovanými jmény schématu.
 *
 * SCHEMA POZNÁMKA (Feature #42 — SMS ticket delivery):
 *   Tabulka tickets.sms_log musí mít sloupec `type` typu TEXT (nebo ENUM)
 *   s hodnotami 'reminder' | 'delivery', default 'reminder'. Je nutná migrace:
 *     ALTER TABLE tickets.sms_log
 *       ADD COLUMN type TEXT NOT NULL DEFAULT 'reminder'
 *       CHECK (type IN ('reminder', 'delivery'));
 *     CREATE INDEX idx_sms_log_ticket_type ON tickets.sms_log (ticket_id, type);
 */

import type {
  DbAdapter,
  BarcodeTicket,
  SmsReminderRow,
  InsertSmsLog,
  SmsStatus,
  SmsLogType,
  SmsDelivery,
  TicketStatus,
} from '../types/barcode.types.js';
import { SmsStatus as SmsStatusEnum } from '../types/barcode.types.js';

// Lazy import pg pro tree-shaking v testech
// V produkci: import { Pool } from 'pg';
type PoolClient = {
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
  release(): void;
};

type Pool = {
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
  connect(): Promise<PoolClient>;
};

// ---------------------------------------------------------------------------
// Row typy z DB
// ---------------------------------------------------------------------------

interface TicketRow {
  id: string;
  ticket_type_id: string;
  owner_id: string;
  holder_name: string | null;
  barcode_code: string | null;
  short_code: string | null;
  barcode_scanned_at: Date | null;
  barcode_scanned_by: string | null;
  status: string;
  event_id: string;
  event_name: string;
  event_date_start: Date;
  event_date_end: Date | null;
  venue_id: string;
  venue_name: string;
  venue_address: string;
  zone: string | null;
  seat_info: string | null;
}

interface SmsReminderRowDb {
  ticket_id: string;
  barcode_code: string | null;
  short_code: string | null;
  phone: string;
  holder_name: string;
  event_name: string;
  event_date_start: Date;
  venue_name: string;
  venue_address: string;
}

// ---------------------------------------------------------------------------
// Mapování DB row → doménový typ
// ---------------------------------------------------------------------------

function mapTicketRow(row: TicketRow): BarcodeTicket {
  return {
    id: row.id,
    ticketTypeId: row.ticket_type_id,
    ownerId: row.owner_id,
    holderName: row.holder_name ?? 'Neznámý držitel',
    barcodeCode: row.barcode_code,
    shortCode: row.short_code,
    barcodeScannedAt: row.barcode_scanned_at,
    barcodeScannedBy: row.barcode_scanned_by,
    status: row.status as TicketStatus,
    eventId: row.event_id,
    eventName: row.event_name,
    eventDateStart: row.event_date_start,
    eventDateEnd: row.event_date_end,
    venueId: row.venue_id,
    venueName: row.venue_name,
    venueAddress: row.venue_address,
    zone: row.zone,
    seatInfo: row.seat_info,
  };
}

// ---------------------------------------------------------------------------
// SQL dotazy
// ---------------------------------------------------------------------------

/**
 * Kompletní SELECT pro vstupenku s JOINy.
 * Používá plně kvalifikovaná jména schémat (tickets, catalog, identity).
 */
const TICKET_SELECT_SQL = `
  SELECT
    t.id,
    t.ticket_type_id,
    t.owner_id,
    u.name AS holder_name,
    t.barcode_code,
    t.short_code,
    t.barcode_scanned_at,
    t.barcode_scanned_by,
    t.status,
    e.id AS event_id,
    e.title AS event_name,
    e.date_start AS event_date_start,
    e.date_end AS event_date_end,
    v.id AS venue_id,
    v.name AS venue_name,
    v.address AS venue_address,
    tt.zone,
    CASE
      WHEN s.id IS NOT NULL
        THEN 'Sektor ' || s.section || ', řada ' || s.row || ', místo ' || s.seat_number
      ELSE NULL
    END AS seat_info
  FROM tickets.tickets t
  JOIN catalog.ticket_types tt ON t.ticket_type_id = tt.id
  JOIN catalog.events e ON tt.event_id = e.id
  JOIN catalog.venues v ON e.venue_id = v.id
  JOIN identity.users u ON t.owner_id = u.id
  LEFT JOIN catalog.seats s ON t.seat_id = s.id
`;

// ---------------------------------------------------------------------------
// Produkční DbAdapter implementace
// ---------------------------------------------------------------------------

class PostgresDbAdapter implements DbAdapter {
  constructor(private readonly pool: Pool) {}

  async getTicketWithEventByBarcode(barcodeCode: string): Promise<BarcodeTicket | null> {
    const { rows } = await this.pool.query<TicketRow>(
      `${TICKET_SELECT_SQL} WHERE t.barcode_code = $1`,
      [barcodeCode],
    );
    return rows[0] ? mapTicketRow(rows[0]) : null;
  }

  async getTicketByShortCode(shortCode: string): Promise<BarcodeTicket | null> {
    const { rows } = await this.pool.query<TicketRow>(
      `${TICKET_SELECT_SQL} WHERE t.short_code = $1`,
      [shortCode],
    );
    return rows[0] ? mapTicketRow(rows[0]) : null;
  }

  async getTicketById(ticketId: string): Promise<BarcodeTicket | null> {
    const { rows } = await this.pool.query<TicketRow>(
      `${TICKET_SELECT_SQL} WHERE t.id = $1`,
      [ticketId],
    );
    return rows[0] ? mapTicketRow(rows[0]) : null;
  }

  async assignBarcodeCodes(
    ticketId: string,
    barcodeCode: string,
    shortCode: string,
  ): Promise<boolean> {
    const { rows } = await this.pool.query<{ id: string }>(
      `UPDATE tickets.tickets
       SET barcode_code = $2, short_code = $3
       WHERE id = $1
         AND barcode_code IS NULL
         AND short_code IS NULL
       RETURNING id`,
      [ticketId, barcodeCode, shortCode],
    );
    return (rows.length ?? 0) > 0;
  }

  async markBarcodeScanned(
    ticketId: string,
    deviceId: string,
    scannedAt: Date,
  ): Promise<boolean> {
    const { rows } = await this.pool.query<{ id: string }>(
      `UPDATE tickets.tickets
       SET barcode_scanned_at = $2, barcode_scanned_by = $3, status = 'used'
       WHERE id = $1
         AND barcode_scanned_at IS NULL
       RETURNING id`,
      [ticketId, scannedAt.toISOString(), deviceId],
    );
    return (rows.length ?? 0) > 0;
  }

  async barcodeCodeExists(barcodeCode: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM tickets.tickets WHERE barcode_code = $1
       ) AS exists`,
      [barcodeCode],
    );
    return rows[0]?.exists ?? false;
  }

  async shortCodeExists(shortCode: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM tickets.tickets WHERE short_code = $1
       ) AS exists`,
      [shortCode],
    );
    return rows[0]?.exists ?? false;
  }

  async getTicketsForSmsReminder(): Promise<SmsReminderRow[]> {
    const { rows } = await this.pool.query<SmsReminderRowDb>(
      `SELECT
         t.id           AS ticket_id,
         t.barcode_code,
         t.short_code,
         u.phone,
         u.name         AS holder_name,
         e.title        AS event_name,
         e.date_start   AS event_date_start,
         v.name         AS venue_name,
         v.address      AS venue_address
       FROM tickets.tickets t
       JOIN identity.users u ON t.owner_id = u.id
       JOIN catalog.ticket_types tt ON t.ticket_type_id = tt.id
       JOIN catalog.events e ON tt.event_id = e.id
       JOIN catalog.venues v ON e.venue_id = v.id
       LEFT JOIN tickets.sms_log sl
         ON sl.ticket_id = t.id
         AND sl.status IN ('sent', 'delivered')
       WHERE DATE(e.date_start AT TIME ZONE 'Europe/Prague') = CURRENT_DATE + INTERVAL '1 day'
         AND t.status = 'valid'
         AND u.phone IS NOT NULL
         AND u.deleted_at IS NULL
         AND u.anonymized_at IS NULL
         AND sl.id IS NULL
       ORDER BY e.date_start ASC`,
    );

    return rows.map((row) => ({
      ticketId: row.ticket_id,
      barcodeCode: row.barcode_code,
      shortCode: row.short_code,
      phone: row.phone,
      holderName: row.holder_name,
      eventName: row.event_name,
      eventDateStart: row.event_date_start,
      venueName: row.venue_name,
      venueAddress: row.venue_address,
    }));
  }

  async insertSmsLog(entry: InsertSmsLog): Promise<number> {
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO tickets.sms_log
         (ticket_id, phone, message_sid, status, sent_at, error_message, type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        entry.ticketId,
        entry.phone,
        entry.messageSid,
        entry.status,
        entry.sentAt?.toISOString() ?? null,
        entry.errorMessage,
        entry.type ?? 'reminder',
      ],
    );
    const idStr = rows[0]?.id;
    if (!idStr) throw new Error('INSERT sms_log nevrátil ID');
    return parseInt(idStr, 10);
  }

  async updateSmsLogStatus(messageSid: string, status: SmsStatus): Promise<void> {
    await this.pool.query(
      `UPDATE tickets.sms_log
       SET status = $2
       WHERE message_sid = $1`,
      [messageSid, status],
    );
  }

  async findSmsLogByTicketAndType(
    ticketId: string,
    type: SmsLogType,
  ): Promise<SmsDelivery | null> {
    const { rows } = await this.pool.query<{
      id: string;
      ticket_id: string;
      phone: string;
      message_sid: string | null;
      status: string;
      sent_at: Date | null;
      error_message: string | null;
    }>(
      `SELECT id, ticket_id, phone, message_sid, status, sent_at, error_message
       FROM tickets.sms_log
       WHERE ticket_id = $1 AND type = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [ticketId, type],
    );

    const row = rows[0];
    if (!row) return null;

    return {
      smsLogId: parseInt(row.id, 10),
      ticketId: row.ticket_id,
      phone: row.phone,
      messageSid: row.message_sid,
      status: row.status as SmsStatusEnum,
      sentAt: row.sent_at,
      errorMessage: row.error_message,
    };
  }
}

// ---------------------------------------------------------------------------
// Factory funkce
// ---------------------------------------------------------------------------

/**
 * Vytvoří PostgresDbAdapter s pg Pool.
 *
 * @param connectionString - PostgreSQL connection string (DATABASE_URL)
 */
export async function createDbAdapter(connectionString: string): Promise<DbAdapter> {
  // Dynamický import pg pro tree-shaking v testech
  const { Pool } = await import('pg' as string) as { Pool: new (config: { connectionString: string; max: number; idleTimeoutMillis: number; connectionTimeoutMillis: number }) => Pool };

  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  return new PostgresDbAdapter(pool);
}
