// ---------------------------------------------------------------------------
// SQLite schema initialisation — expo-sqlite (synchronous API)
// ---------------------------------------------------------------------------
import * as SQLite from "expo-sqlite";

let _db: SQLite.SQLiteDatabase | null = null;

/**
 * Opens (or returns cached) the SQLite database and ensures the schema is
 * up to date. Safe to call multiple times — uses IF NOT EXISTS guards.
 */
export function initDB(): SQLite.SQLiteDatabase {
  if (_db) return _db;

  _db = SQLite.openDatabaseSync("scanner.db");

  _db.execSync(`PRAGMA journal_mode = WAL;`);
  _db.execSync(`PRAGMA foreign_keys = ON;`);

  _db.execSync(`
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

    CREATE TABLE IF NOT EXISTS metadata (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  return _db;
}

/** Closes and resets the DB singleton — useful for tests. */
export function resetDB(): void {
  _db = null;
}
