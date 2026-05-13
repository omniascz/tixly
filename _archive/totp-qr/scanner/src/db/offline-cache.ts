import Database from "better-sqlite3";
import path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TicketRow {
  ticket_id: string;
  totp_secret_encrypted: Buffer;
  totp_secret_iv: Buffer;
  status: "active" | "revoked" | "used";
  holder_name: string;
  seat_info: string;
  synced_at: number; // unix seconds
}

export interface ScannedTokenRow {
  ticket_id: string;
  totp_value: string;
  scanned_at: number; // unix seconds
}

// ---------------------------------------------------------------------------
// DB singleton
// ---------------------------------------------------------------------------

let _db: Database.Database | null = null;

function getDB(): Database.Database {
  if (!_db) {
    throw new Error("DB not initialised — call initDB() first");
  }
  return _db;
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Opens (or creates) the SQLite database and ensures the schema is up to date.
 * Safe to call multiple times — uses IF NOT EXISTS guards.
 */
export function initDB(dbPath: string = path.join(process.cwd(), "scanner.db")): void {
  _db = new Database(dbPath);

  // Enable WAL mode for better read/write concurrency
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  _db.exec(`
    CREATE TABLE IF NOT EXISTS tickets (
      ticket_id              TEXT    PRIMARY KEY,
      totp_secret_encrypted  BLOB    NOT NULL,
      totp_secret_iv         BLOB    NOT NULL,
      status                 TEXT    NOT NULL CHECK(status IN ('active','revoked','used')),
      holder_name            TEXT    NOT NULL,
      seat_info              TEXT    NOT NULL,
      synced_at              INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scanned_tokens (
      ticket_id   TEXT    NOT NULL,
      totp_value  TEXT    NOT NULL,
      scanned_at  INTEGER NOT NULL,
      PRIMARY KEY (ticket_id, totp_value)
    );
  `);
}

// ---------------------------------------------------------------------------
// CRUD helpers
// ---------------------------------------------------------------------------

/**
 * Insert or replace tickets received from the server sync endpoint.
 * Uses a transaction for bulk performance.
 */
export function upsertTickets(tickets: TicketRow[]): void {
  const db = getDB();
  const stmt = db.prepare(`
    INSERT INTO tickets
      (ticket_id, totp_secret_encrypted, totp_secret_iv, status, holder_name, seat_info, synced_at)
    VALUES
      (@ticket_id, @totp_secret_encrypted, @totp_secret_iv, @status, @holder_name, @seat_info, @synced_at)
    ON CONFLICT(ticket_id) DO UPDATE SET
      totp_secret_encrypted = excluded.totp_secret_encrypted,
      totp_secret_iv        = excluded.totp_secret_iv,
      status                = excluded.status,
      holder_name           = excluded.holder_name,
      seat_info             = excluded.seat_info,
      synced_at             = excluded.synced_at
  `);

  const runAll = db.transaction((rows: TicketRow[]) => {
    for (const row of rows) {
      stmt.run(row);
    }
  });

  runAll(tickets);
}

/**
 * Retrieves a single ticket by ID.
 * Returns null if not found in the local cache.
 */
export function getTicket(ticketId: string): TicketRow | null {
  const db = getDB();
  const row = db
    .prepare("SELECT * FROM tickets WHERE ticket_id = ?")
    .get(ticketId) as TicketRow | undefined;
  return row ?? null;
}

/**
 * Marks a ticket's status as 'used' and records the scan timestamp.
 */
export function markAsScanned(ticketId: string, scannedAt: Date): void {
  const db = getDB();
  db.prepare(
    "UPDATE tickets SET status = 'used', synced_at = ? WHERE ticket_id = ?"
  ).run(Math.floor(scannedAt.getTime() / 1000), ticketId);
}

/**
 * Records a TOTP value as scanned for anti-replay purposes.
 * Returns false if the (ticketId, totpValue) pair already exists.
 */
export function recordScannedToken(
  ticketId: string,
  totpValue: string
): boolean {
  const db = getDB();
  try {
    db.prepare(
      "INSERT INTO scanned_tokens (ticket_id, totp_value, scanned_at) VALUES (?, ?, ?)"
    ).run(ticketId, totpValue, Math.floor(Date.now() / 1000));
    return true;
  } catch {
    // UNIQUE constraint violation — already scanned
    return false;
  }
}

/**
 * Removes tickets (and their scanned tokens) that were last synced before
 * the cutoff time. Used to purge data after an event.
 */
export function clearOldData(cutoffUnixSec: number): void {
  const db = getDB();
  const tx = db.transaction(() => {
    // Remove scanned tokens for old tickets first (FK safety)
    db.prepare(`
      DELETE FROM scanned_tokens
      WHERE ticket_id IN (
        SELECT ticket_id FROM tickets WHERE synced_at < ?
      )
    `).run(cutoffUnixSec);

    db.prepare("DELETE FROM tickets WHERE synced_at < ?").run(cutoffUnixSec);
  });
  tx();
}
