/**
 * Real DB adapter for Apple Wallet device registrations and pass data.
 *
 * Implements the AppleWalletDBAdapter interface from apple-wallet.service.ts
 * using standard parameterised SQL queries.
 *
 * Tables used (created by migration 226_wallet_passes_db.sql):
 *   wallet_device_registrations  — device ↔ pass push-token bindings
 *   wallet_pass_updates          — immutable update log for /passesUpdatedSince
 *
 * The `db` parameter must expose a `query(sql, params)` method that returns
 * `{ rows: T[] }` — compatible with pg (node-postgres) and any adapter that
 * mirrors its interface.
 */

import type { AppleWalletDBAdapter } from "../services/apple-wallet.service.js";
import type { ApplePassRegistration } from "../types/wallet.js";

// ---------------------------------------------------------------------------
// Generic DB query interface (compatible with node-postgres `Pool` / `Client`)
// ---------------------------------------------------------------------------

export interface DbQueryable {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: T[] }>;
}

// ---------------------------------------------------------------------------
// Extended pass-data types for standalone use
// ---------------------------------------------------------------------------

export interface PassData {
  serialNumber: string;
  passTypeIdentifier: string;
  authToken: string;
  lastUpdated: string;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Extended adapter interface (superset of AppleWalletDBAdapter)
// ---------------------------------------------------------------------------

export interface WalletDbAdapter extends AppleWalletDBAdapter {
  // Device registration
  registerDevice(
    deviceLibraryIdentifier: string,
    passTypeIdentifier: string,
    serialNumber: string,
    pushToken: string
  ): Promise<void>;
  unregisterDevice(
    deviceLibraryIdentifier: string,
    passTypeIdentifier: string,
    serialNumber: string
  ): Promise<void>;
  getDevicesForPass(
    passTypeIdentifier: string,
    serialNumber: string
  ): Promise<string[]>;
  getRegisteredPasses(
    deviceLibraryIdentifier: string,
    passTypeIdentifier: string,
    updatedSince?: string
  ): Promise<string[]>;

  // Pass data storage
  getPassData(
    passTypeIdentifier: string,
    serialNumber: string
  ): Promise<PassData | null>;
  updatePassData(
    passTypeIdentifier: string,
    serialNumber: string,
    data: Partial<PassData>
  ): Promise<void>;
  recordPassUpdate(
    passTypeIdentifier: string,
    serialNumber: string
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Row shapes returned from the DB
// ---------------------------------------------------------------------------

interface RegistrationRow {
  push_token: string;
  serial_number: string;
  device_library_identifier: string;
  pass_type_identifier: string;
  registered_at: string;
}

interface PassDataRow {
  serial_number: string;
  pass_type_identifier: string;
  auth_token: string;
  last_updated: string;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a WalletDbAdapter backed by the supplied DB connection.
 *
 * @param db - A node-postgres-compatible Pool or Client instance.
 */
export function createWalletDbAdapter(db: DbQueryable): WalletDbAdapter {
  return {
    // ------------------------------------------------------------------
    // AppleWalletDBAdapter — required by AppleWalletService
    // ------------------------------------------------------------------

    async getRegistrations(serialNumber: string): Promise<ApplePassRegistration[]> {
      const { rows } = await db.query<RegistrationRow>(
        `SELECT device_library_identifier, push_token, pass_type_identifier, serial_number, registered_at
           FROM wallet_device_registrations
          WHERE serial_number = $1`,
        [serialNumber]
      );
      return rows.map((r) => ({
        id: "",
        deviceLibraryIdentifier: r.device_library_identifier,
        pushToken: r.push_token,
        passTypeIdentifier: r.pass_type_identifier,
        serialNumber: r.serial_number,
        registeredAt: new Date(r.registered_at),
      }));
    },

    async upsertRegistration(
      reg: Omit<ApplePassRegistration, "id">
    ): Promise<void> {
      await db.query(
        `INSERT INTO wallet_device_registrations
           (device_library_identifier, pass_type_identifier, serial_number, push_token)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (device_library_identifier, pass_type_identifier, serial_number)
         DO UPDATE SET push_token = EXCLUDED.push_token, registered_at = NOW()`,
        [
          reg.deviceLibraryIdentifier,
          reg.passTypeIdentifier,
          reg.serialNumber,
          reg.pushToken,
        ]
      );
    },

    async deleteRegistration(
      deviceLibraryIdentifier: string,
      serialNumber: string
    ): Promise<void> {
      await db.query(
        `DELETE FROM wallet_device_registrations
          WHERE device_library_identifier = $1
            AND serial_number = $2`,
        [deviceLibraryIdentifier, serialNumber]
      );
    },

    async getUpdatedSerials(
      passTypeIdentifier: string,
      deviceLibraryIdentifier: string,
      since: Date
    ): Promise<string[]> {
      const { rows } = await db.query<{ serial_number: string }>(
        `SELECT DISTINCT r.serial_number
           FROM wallet_device_registrations r
           JOIN wallet_pass_updates u
             ON u.pass_type_identifier = r.pass_type_identifier
            AND u.serial_number = r.serial_number
          WHERE r.device_library_identifier = $1
            AND r.pass_type_identifier = $2
            AND u.updated_at > $3
          ORDER BY r.serial_number`,
        [deviceLibraryIdentifier, passTypeIdentifier, since.toISOString()]
      );
      return rows.map((r) => r.serial_number);
    },

    async getAuthToken(serialNumber: string): Promise<string | null> {
      const { rows } = await db.query<{ auth_token: string }>(
        `SELECT auth_token
           FROM wallet_passes_data
          WHERE serial_number = $1
          LIMIT 1`,
        [serialNumber]
      );
      return rows[0]?.auth_token ?? null;
    },

    // ------------------------------------------------------------------
    // Extended WalletDbAdapter methods
    // ------------------------------------------------------------------

    async registerDevice(
      deviceLibraryIdentifier: string,
      passTypeIdentifier: string,
      serialNumber: string,
      pushToken: string
    ): Promise<void> {
      await db.query(
        `INSERT INTO wallet_device_registrations
           (device_library_identifier, pass_type_identifier, serial_number, push_token)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (device_library_identifier, pass_type_identifier, serial_number)
         DO UPDATE SET push_token = EXCLUDED.push_token, registered_at = NOW()`,
        [deviceLibraryIdentifier, passTypeIdentifier, serialNumber, pushToken]
      );
    },

    async unregisterDevice(
      deviceLibraryIdentifier: string,
      passTypeIdentifier: string,
      serialNumber: string
    ): Promise<void> {
      await db.query(
        `DELETE FROM wallet_device_registrations
          WHERE device_library_identifier = $1
            AND pass_type_identifier = $2
            AND serial_number = $3`,
        [deviceLibraryIdentifier, passTypeIdentifier, serialNumber]
      );
    },

    async getDevicesForPass(
      passTypeIdentifier: string,
      serialNumber: string
    ): Promise<string[]> {
      const { rows } = await db.query<{ push_token: string }>(
        `SELECT push_token
           FROM wallet_device_registrations
          WHERE pass_type_identifier = $1
            AND serial_number = $2`,
        [passTypeIdentifier, serialNumber]
      );
      return rows.map((r) => r.push_token);
    },

    async getRegisteredPasses(
      deviceLibraryIdentifier: string,
      passTypeIdentifier: string,
      updatedSince?: string
    ): Promise<string[]> {
      if (updatedSince) {
        const { rows } = await db.query<{ serial_number: string }>(
          `SELECT DISTINCT r.serial_number
             FROM wallet_device_registrations r
             JOIN wallet_pass_updates u
               ON u.pass_type_identifier = r.pass_type_identifier
              AND u.serial_number = r.serial_number
            WHERE r.device_library_identifier = $1
              AND r.pass_type_identifier = $2
              AND u.updated_at > $3
            ORDER BY r.serial_number`,
          [deviceLibraryIdentifier, passTypeIdentifier, updatedSince]
        );
        return rows.map((r) => r.serial_number);
      }

      const { rows } = await db.query<{ serial_number: string }>(
        `SELECT serial_number
           FROM wallet_device_registrations
          WHERE device_library_identifier = $1
            AND pass_type_identifier = $2
          ORDER BY serial_number`,
        [deviceLibraryIdentifier, passTypeIdentifier]
      );
      return rows.map((r) => r.serial_number);
    },

    async getPassData(
      passTypeIdentifier: string,
      serialNumber: string
    ): Promise<PassData | null> {
      const { rows } = await db.query<PassDataRow>(
        `SELECT serial_number, pass_type_identifier, auth_token, last_updated, data
           FROM wallet_passes_data
          WHERE pass_type_identifier = $1
            AND serial_number = $2
          LIMIT 1`,
        [passTypeIdentifier, serialNumber]
      );
      const row = rows[0];
      if (!row) return null;
      return {
        serialNumber: row.serial_number,
        passTypeIdentifier: row.pass_type_identifier,
        authToken: row.auth_token,
        lastUpdated: row.last_updated,
        data: row.data ?? {},
      };
    },

    async updatePassData(
      passTypeIdentifier: string,
      serialNumber: string,
      data: Partial<PassData>
    ): Promise<void> {
      const setClauses: string[] = [];
      const params: unknown[] = [passTypeIdentifier, serialNumber];
      let idx = 3;

      if (data.authToken !== undefined) {
        setClauses.push(`auth_token = $${idx++}`);
        params.push(data.authToken);
      }
      if (data.lastUpdated !== undefined) {
        setClauses.push(`last_updated = $${idx++}`);
        params.push(data.lastUpdated);
      }
      if (data.data !== undefined) {
        setClauses.push(`data = $${idx++}`);
        params.push(JSON.stringify(data.data));
      }

      if (setClauses.length === 0) return;

      await db.query(
        `UPDATE wallet_passes_data
            SET ${setClauses.join(", ")}
          WHERE pass_type_identifier = $1
            AND serial_number = $2`,
        params
      );
    },

    async recordPassUpdate(
      passTypeIdentifier: string,
      serialNumber: string
    ): Promise<void> {
      await db.query(
        `INSERT INTO wallet_pass_updates (pass_type_identifier, serial_number)
         VALUES ($1, $2)`,
        [passTypeIdentifier, serialNumber]
      );
    },
  };
}
