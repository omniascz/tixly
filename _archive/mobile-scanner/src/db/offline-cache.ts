// ---------------------------------------------------------------------------
// Offline SQLite cache — expo-sqlite (synchronous API)
// Adapted from totp-qr/scanner/src/db/offline-cache.ts
// ---------------------------------------------------------------------------
import { initDB } from "./schema";
import type { TicketRow } from "../types/scanner.types";

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

/**
 * Insert or update tickets received from the server sync endpoint.
 * Uses a transaction for bulk performance.
 */
export function upsertTickets(tickets: TicketRow[]): void {
  const db = initDB();
  db.withTransactionSync(() => {
    for (const row of tickets) {
      db.runSync(
        `INSERT INTO tickets
          (ticket_id, totp_secret_encrypted, totp_secret_iv, status, holder_name, seat_info, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(ticket_id) DO UPDATE SET
           totp_secret_encrypted = excluded.totp_secret_encrypted,
           totp_secret_iv        = excluded.totp_secret_iv,
           status                = excluded.status,
           holder_name           = excluded.holder_name,
           seat_info             = excluded.seat_info,
           synced_at             = excluded.synced_at`,
        [
          row.ticket_id,
          row.totp_secret_encrypted,
          row.totp_secret_iv,
          row.status,
          row.holder_name,
          row.seat_info,
          row.synced_at,
        ]
      );
    }
  });
}

/**
 * Retrieves a single ticket by ID.
 * Returns null if not found in the local cache.
 */
export function getTicket(ticketId: string): TicketRow | null {
  const db = initDB();
  const rows = db.getAllSync<TicketRow>(
    "SELECT * FROM tickets WHERE ticket_id = ?",
    [ticketId]
  );
  return rows[0] ?? null;
}

/**
 * Marks a ticket's status as 'used' and records the scan timestamp.
 */
export function markAsScanned(ticketId: string, scannedAt: Date): void {
  const db = initDB();
  db.runSync(
    "UPDATE tickets SET status = 'used', synced_at = ? WHERE ticket_id = ?",
    [Math.floor(scannedAt.getTime() / 1000), ticketId]
  );
}

/**
 * Soft-deletes (revokes) a list of tickets by setting status = 'revoked'.
 */
export function revokeTickets(ticketIds: string[]): void {
  if (ticketIds.length === 0) return;
  const db = initDB();
  db.withTransactionSync(() => {
    for (const id of ticketIds) {
      db.runSync(
        "UPDATE tickets SET status = 'revoked' WHERE ticket_id = ?",
        [id]
      );
    }
  });
}

/**
 * Returns the total number of tickets in the local cache.
 */
export function countCachedTickets(): number {
  const db = initDB();
  const rows = db.getAllSync<{ count: number }>(
    "SELECT COUNT(*) as count FROM tickets"
  );
  return rows[0]?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Scanned tokens (anti-replay)
// ---------------------------------------------------------------------------

/**
 * Records a TOTP value as scanned for anti-replay purposes.
 * Returns false if the (ticketId, totpValue) pair already exists.
 */
export function recordScannedToken(
  ticketId: string,
  totpValue: string
): boolean {
  const db = initDB();
  try {
    db.runSync(
      "INSERT INTO scanned_tokens (ticket_id, totp_value, scanned_at) VALUES (?, ?, ?)",
      [ticketId, totpValue, Math.floor(Date.now() / 1000)]
    );
    return true;
  } catch {
    // UNIQUE constraint violation — already scanned
    return false;
  }
}

// ---------------------------------------------------------------------------
// Metadata (sync timestamps)
// ---------------------------------------------------------------------------

/**
 * Reads a metadata value by key; returns null if absent.
 */
export function getMetadata(key: string): string | null {
  const db = initDB();
  const rows = db.getAllSync<{ value: string }>(
    "SELECT value FROM metadata WHERE key = ?",
    [key]
  );
  return rows[0]?.value ?? null;
}

/**
 * Upserts a metadata key-value pair.
 */
export function setMetadata(key: string, value: string): void {
  const db = initDB();
  db.runSync(
    `INSERT INTO metadata (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
}

// ---------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------

/**
 * Removes tickets (and their scanned tokens) last synced before the cutoff.
 * Used to purge data after an event ends.
 */
export function clearOldData(cutoffUnixSec: number): void {
  const db = initDB();
  db.withTransactionSync(() => {
    // Remove scanned tokens for old tickets first (FK safety)
    db.runSync(
      `DELETE FROM scanned_tokens
       WHERE ticket_id IN (
         SELECT ticket_id FROM tickets WHERE synced_at < ?
       )`,
      [cutoffUnixSec]
    );
    db.runSync("DELETE FROM tickets WHERE synced_at < ?", [cutoffUnixSec]);
  });
}
