// ---------------------------------------------------------------------------
// offline-cache.test.ts — tests for SQLite CRUD helpers
// Uses in-memory expo-sqlite mock
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock expo-sqlite before importing offline-cache
vi.mock("expo-sqlite", () => import("./__mocks__/expo-sqlite"));

// Reset DB and schema singleton before each test
beforeEach(async () => {
  const { __resetDatabase } = await import("./__mocks__/expo-sqlite");
  __resetDatabase();

  // Re-import resetDB to clear the singleton in schema.ts
  vi.resetModules();
});

import type { TicketRow } from "../types/scanner.types";

function makeTicket(overrides: Partial<TicketRow> = {}): TicketRow {
  return {
    ticket_id: "tkt-001",
    totp_secret_encrypted: new Uint8Array([1, 2, 3]),
    totp_secret_iv: new Uint8Array([4, 5, 6]),
    status: "active",
    holder_name: "Jan Novák",
    seat_info: "Sector A, Row 3, Seat 12",
    synced_at: 1_700_000_000,
    ...overrides,
  };
}

describe("upsertTickets", () => {
  it("inserts a new ticket", async () => {
    const { upsertTickets, getTicket } = await import("../db/offline-cache");
    const ticket = makeTicket();
    upsertTickets([ticket]);
    const result = getTicket("tkt-001");
    expect(result).not.toBeNull();
    expect(result?.holder_name).toBe("Jan Novák");
  });

  it("updates an existing ticket on conflict", async () => {
    const { upsertTickets, getTicket } = await import("../db/offline-cache");
    upsertTickets([makeTicket({ holder_name: "Original Name" })]);
    upsertTickets([makeTicket({ holder_name: "Updated Name" })]);
    const result = getTicket("tkt-001");
    expect(result?.holder_name).toBe("Updated Name");
  });

  it("inserts multiple tickets in a single call", async () => {
    const { upsertTickets, getTicket } = await import("../db/offline-cache");
    upsertTickets([
      makeTicket({ ticket_id: "tkt-001" }),
      makeTicket({ ticket_id: "tkt-002" }),
    ]);
    expect(getTicket("tkt-001")).not.toBeNull();
    expect(getTicket("tkt-002")).not.toBeNull();
  });
});

describe("getTicket", () => {
  it("returns the ticket row for an existing ticket", async () => {
    const { upsertTickets, getTicket } = await import("../db/offline-cache");
    upsertTickets([makeTicket()]);
    const row = getTicket("tkt-001");
    expect(row?.ticket_id).toBe("tkt-001");
    expect(row?.status).toBe("active");
  });

  it("returns null for a non-existent ticket", async () => {
    const { getTicket } = await import("../db/offline-cache");
    expect(getTicket("does-not-exist")).toBeNull();
  });
});

describe("markAsScanned", () => {
  it("changes ticket status to 'used'", async () => {
    const { upsertTickets, getTicket, markAsScanned } = await import(
      "../db/offline-cache"
    );
    upsertTickets([makeTicket({ status: "active" })]);
    markAsScanned("tkt-001", new Date(1_700_001_000 * 1000));
    const row = getTicket("tkt-001");
    expect(row?.status).toBe("used");
  });
});

describe("recordScannedToken", () => {
  it("returns true on first scan of a token", async () => {
    const { recordScannedToken } = await import("../db/offline-cache");
    const result = recordScannedToken("tkt-001", "12345678");
    expect(result).toBe(true);
  });

  it("returns false on second scan of the same token (anti-replay)", async () => {
    const { recordScannedToken } = await import("../db/offline-cache");
    recordScannedToken("tkt-001", "12345678");
    const result = recordScannedToken("tkt-001", "12345678");
    expect(result).toBe(false);
  });

  it("allows same token for a different ticket", async () => {
    const { recordScannedToken } = await import("../db/offline-cache");
    recordScannedToken("tkt-001", "12345678");
    const result = recordScannedToken("tkt-002", "12345678");
    expect(result).toBe(true);
  });

  it("allows different token for the same ticket", async () => {
    const { recordScannedToken } = await import("../db/offline-cache");
    recordScannedToken("tkt-001", "12345678");
    const result = recordScannedToken("tkt-001", "87654321");
    expect(result).toBe(true);
  });
});

describe("clearOldData", () => {
  it("removes tickets with synced_at older than cutoff", async () => {
    const { upsertTickets, getTicket, clearOldData } = await import(
      "../db/offline-cache"
    );
    upsertTickets([
      makeTicket({ ticket_id: "old-1", synced_at: 1_000 }),
      makeTicket({ ticket_id: "new-1", synced_at: 2_000 }),
    ]);
    clearOldData(1_500);
    expect(getTicket("old-1")).toBeNull();
    expect(getTicket("new-1")).not.toBeNull();
  });

  it("keeps tickets with synced_at equal to or after cutoff", async () => {
    const { upsertTickets, getTicket, clearOldData } = await import(
      "../db/offline-cache"
    );
    upsertTickets([makeTicket({ synced_at: 1_500 })]);
    clearOldData(1_500);
    // synced_at < cutoff is the delete condition, so 1500 < 1500 is false → kept
    expect(getTicket("tkt-001")).not.toBeNull();
  });
});
