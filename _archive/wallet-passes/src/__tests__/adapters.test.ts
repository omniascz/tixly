/**
 * Tests for real DB adapter and APN push client.
 * B12 — Apple Wallet real adapters for Tixly ticketing platform.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createWalletDbAdapter,
  type DbQueryable,
} from "../lib/db-adapter.js";
import {
  createApnPushClient,
  sendBatchApnPush,
  type SendApnPushFn,
  type ApnPushResult,
} from "../lib/apn-client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a mock DbQueryable that returns rows from the supplied queue. */
function makeMockDb(
  rowSets: Array<Record<string, unknown>[]> = []
): DbQueryable & { query: ReturnType<typeof vi.fn> } {
  let callIdx = 0;
  const query = vi.fn(async () => {
    const rows = rowSets[callIdx++] ?? [];
    return { rows };
  });
  return { query };
}

// ---------------------------------------------------------------------------
// APN client tests
// ---------------------------------------------------------------------------

describe("createApnPushClient", () => {
  it("returns a function", () => {
    const fn = createApnPushClient({
      passTypeIdentifier: "pass.cz.tixly.ticket",
      environment: "sandbox",
      apnKeyId: "KEY123",
      apnTeamId: "TEAM123",
      apnPrivateKey: "not-a-real-key",
    });
    expect(typeof fn).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// sendBatchApnPush tests
// ---------------------------------------------------------------------------

describe("sendBatchApnPush", () => {
  const passType = "pass.cz.tixly.ticket";

  it("calls sendFn for each token", async () => {
    const mockSend: SendApnPushFn = vi.fn(async (token) => ({
      deviceToken: token,
      success: true,
    }));
    const tokens = ["tok-a", "tok-b", "tok-c"];
    await sendBatchApnPush(tokens, passType, mockSend);
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it("returns correct sent/failed counts on all success", async () => {
    const mockSend: SendApnPushFn = vi.fn(async (token) => ({
      deviceToken: token,
      success: true,
    }));
    const result = await sendBatchApnPush(
      ["tok-1", "tok-2"],
      passType,
      mockSend
    );
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
  });

  it("failed devices do not throw — processing continues", async () => {
    let callCount = 0;
    const mockSend: SendApnPushFn = vi.fn(async (token) => {
      callCount++;
      if (callCount === 2) {
        return { deviceToken: token, success: false, error: "device gone" };
      }
      return { deviceToken: token, success: true };
    });
    await expect(
      sendBatchApnPush(["tok-1", "tok-2", "tok-3"], passType, mockSend)
    ).resolves.not.toThrow();
    expect(callCount).toBe(3);
  });

  it("empty array returns sent=0, failed=0", async () => {
    const mockSend: SendApnPushFn = vi.fn(async (t) => ({
      deviceToken: t,
      success: true,
    }));
    const result = await sendBatchApnPush([], passType, mockSend);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("2 success + 1 failure → sent=2, failed=1", async () => {
    const responses: ApnPushResult[] = [
      { deviceToken: "tok-a", success: true },
      { deviceToken: "tok-b", success: false, statusCode: 410, error: "Unregistered" },
      { deviceToken: "tok-c", success: true },
    ];
    let idx = 0;
    const mockSend: SendApnPushFn = vi.fn(async () => responses[idx++]!);
    const result = await sendBatchApnPush(
      ["tok-a", "tok-b", "tok-c"],
      passType,
      mockSend
    );
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.results).toHaveLength(3);
  });

  it("passes passTypeIdentifier to sendFn", async () => {
    const mockSend: SendApnPushFn = vi.fn(async (token, pti) => ({
      deviceToken: token,
      success: true,
    }));
    await sendBatchApnPush(["tok-x"], "pass.cz.tixly.vip", mockSend);
    expect(mockSend).toHaveBeenCalledWith("tok-x", "pass.cz.tixly.vip");
  });
});

// ---------------------------------------------------------------------------
// WalletDbAdapter tests
// ---------------------------------------------------------------------------

describe("WalletDbAdapter", () => {
  describe("registerDevice", () => {
    it("calls the correct SQL INSERT with all four parameters", async () => {
      const db = makeMockDb([[]]);
      const adapter = createWalletDbAdapter(db);

      await adapter.registerDevice(
        "device-abc",
        "pass.cz.tixly.ticket",
        "ticket-001",
        "push-token-xyz"
      );

      expect(db.query).toHaveBeenCalledTimes(1);
      const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("INSERT INTO wallet_device_registrations");
      expect(params).toEqual([
        "device-abc",
        "pass.cz.tixly.ticket",
        "ticket-001",
        "push-token-xyz",
      ]);
    });
  });

  describe("unregisterDevice", () => {
    it("calls DELETE with device, passType and serial", async () => {
      const db = makeMockDb([[]]);
      const adapter = createWalletDbAdapter(db);

      await adapter.unregisterDevice(
        "device-abc",
        "pass.cz.tixly.ticket",
        "ticket-001"
      );

      expect(db.query).toHaveBeenCalledTimes(1);
      const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("DELETE FROM wallet_device_registrations");
      expect(params).toContain("device-abc");
      expect(params).toContain("ticket-001");
    });
  });

  describe("getDevicesForPass", () => {
    it("returns array of push tokens", async () => {
      const db = makeMockDb([
        [{ push_token: "push-1" }, { push_token: "push-2" }],
      ]);
      const adapter = createWalletDbAdapter(db);

      const tokens = await adapter.getDevicesForPass(
        "pass.cz.tixly.ticket",
        "ticket-001"
      );

      expect(tokens).toEqual(["push-1", "push-2"]);
    });

    it("returns empty array when no registrations found", async () => {
      const db = makeMockDb([[]]);
      const adapter = createWalletDbAdapter(db);

      const tokens = await adapter.getDevicesForPass(
        "pass.cz.tixly.ticket",
        "nonexistent"
      );

      expect(tokens).toEqual([]);
    });
  });

  describe("getRegisteredPasses", () => {
    it("returns serialNumbers for device without updatedSince filter", async () => {
      const db = makeMockDb([
        [{ serial_number: "ticket-1" }, { serial_number: "ticket-2" }],
      ]);
      const adapter = createWalletDbAdapter(db);

      const serials = await adapter.getRegisteredPasses(
        "device-abc",
        "pass.cz.tixly.ticket"
      );

      expect(serials).toEqual(["ticket-1", "ticket-2"]);
    });

    it("applies updatedSince filter when provided", async () => {
      const db = makeMockDb([[{ serial_number: "ticket-3" }]]);
      const adapter = createWalletDbAdapter(db);

      const serials = await adapter.getRegisteredPasses(
        "device-abc",
        "pass.cz.tixly.ticket",
        "2026-01-01T00:00:00Z"
      );

      expect(serials).toEqual(["ticket-3"]);
      const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("wallet_pass_updates");
      expect(params).toContain("2026-01-01T00:00:00Z");
    });
  });

  describe("getPassData", () => {
    it("returns null for non-existent pass", async () => {
      const db = makeMockDb([[]]);
      const adapter = createWalletDbAdapter(db);

      const result = await adapter.getPassData(
        "pass.cz.tixly.ticket",
        "ticket-nonexistent"
      );

      expect(result).toBeNull();
    });

    it("returns PassData when row exists", async () => {
      const db = makeMockDb([
        [
          {
            serial_number: "ticket-42",
            pass_type_identifier: "pass.cz.tixly.ticket",
            auth_token: "secret-auth-token",
            last_updated: "2026-04-18T12:00:00Z",
            data: { holderName: "Alice" },
          },
        ],
      ]);
      const adapter = createWalletDbAdapter(db);

      const result = await adapter.getPassData(
        "pass.cz.tixly.ticket",
        "ticket-42"
      );

      expect(result).not.toBeNull();
      expect(result!.serialNumber).toBe("ticket-42");
      expect(result!.authToken).toBe("secret-auth-token");
    });
  });

  describe("updatePassData", () => {
    it("calls UPDATE with correct params when authToken is provided", async () => {
      const db = makeMockDb([[]]);
      const adapter = createWalletDbAdapter(db);

      await adapter.updatePassData(
        "pass.cz.tixly.ticket",
        "ticket-99",
        { authToken: "new-token" }
      );

      expect(db.query).toHaveBeenCalledTimes(1);
      const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("UPDATE wallet_passes_data");
      expect(params).toContain("new-token");
    });

    it("is a no-op when data object is empty", async () => {
      const db = makeMockDb();
      const adapter = createWalletDbAdapter(db);

      await adapter.updatePassData("pass.cz.tixly.ticket", "ticket-99", {});

      expect(db.query).not.toHaveBeenCalled();
    });
  });

  describe("recordPassUpdate", () => {
    it("inserts a record into wallet_pass_updates", async () => {
      const db = makeMockDb([[]]);
      const adapter = createWalletDbAdapter(db);

      await adapter.recordPassUpdate("pass.cz.tixly.ticket", "ticket-007");

      expect(db.query).toHaveBeenCalledTimes(1);
      const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("INSERT INTO wallet_pass_updates");
      expect(params).toEqual(["pass.cz.tixly.ticket", "ticket-007"]);
    });
  });
});

// ---------------------------------------------------------------------------
// Factory smoke test
// ---------------------------------------------------------------------------

describe("createWalletDbAdapter", () => {
  it("returns an object with all required methods", () => {
    const db = makeMockDb();
    const adapter = createWalletDbAdapter(db);

    const requiredMethods: Array<keyof typeof adapter> = [
      "getRegistrations",
      "upsertRegistration",
      "deleteRegistration",
      "getUpdatedSerials",
      "getAuthToken",
      "registerDevice",
      "unregisterDevice",
      "getDevicesForPass",
      "getRegisteredPasses",
      "getPassData",
      "updatePassData",
      "recordPassUpdate",
    ];

    for (const method of requiredMethods) {
      expect(typeof adapter[method], `method ${method}`).toBe("function");
    }
  });
});

// ---------------------------------------------------------------------------
// ApnPushResult shape test
// ---------------------------------------------------------------------------

describe("ApnPushResult", () => {
  it("success=false for HTTP non-2xx status", async () => {
    // Simulate a sendFn that returns HTTP 410
    const mockSend: SendApnPushFn = vi.fn(async (token) => ({
      deviceToken: token,
      success: false,
      statusCode: 410,
      error: "Unregistered",
    }));

    const result = await sendBatchApnPush(
      ["dead-token"],
      "pass.cz.tixly.ticket",
      mockSend
    );

    expect(result.results[0]!.success).toBe(false);
    expect(result.results[0]!.statusCode).toBe(410);
    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);
  });
});
