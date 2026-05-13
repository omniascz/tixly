// ---------------------------------------------------------------------------
// sync.test.ts — delta sync logic
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock expo-sqlite before any imports that touch offline-cache
vi.mock("expo-sqlite", () => import("./__mocks__/expo-sqlite"));

// ---------------------------------------------------------------------------
// Mock offline-cache module
// ---------------------------------------------------------------------------

const mockUpsertTickets = vi.fn();
const mockRevokeTickets = vi.fn();
const mockCountCachedTickets = vi.fn().mockReturnValue(50);
const mockGetMetadata = vi.fn().mockReturnValue(null);
const mockSetMetadata = vi.fn();

vi.mock("../db/offline-cache", () => ({
  upsertTickets: mockUpsertTickets,
  revokeTickets: mockRevokeTickets,
  countCachedTickets: mockCountCachedTickets,
  getMetadata: mockGetMetadata,
  setMetadata: mockSetMetadata,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SERVER_TIME = 1_700_001_000;
const EVENT_ID = "event-abc";

const BASE_DEPS = {
  apiBaseUrl: "https://api.tixly.io",
  apiKey: "test-device-token",
};

function makeDeltaResponse(
  tickets: object[] = [],
  deletedIds: string[] = [],
  serverTime: number = SERVER_TIME
) {
  return {
    tickets,
    deletedIds,
    serverTime,
  };
}

function mockFetch(body: object, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? "OK" : "Internal Server Error",
    json: () => Promise.resolve(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockCountCachedTickets.mockReturnValue(50);
  mockGetMetadata.mockReturnValue(null);
});

describe("syncEvent — request format", () => {
  it("calls the correct endpoint with since=0 on first sync", async () => {
    const { syncEvent } = await import("../services/sync.service");
    const fetch = mockFetch(makeDeltaResponse());
    mockGetMetadata.mockReturnValue(null);

    await syncEvent(EVENT_ID, { ...BASE_DEPS, fetch });

    expect(fetch).toHaveBeenCalledOnce();
    const [url] = fetch.mock.calls[0];
    expect(url).toContain(`/api/scanner/events/${EVENT_ID}/tickets/delta`);
    expect(url).toContain("since=0");
  });

  it("uses stored lastSyncAt as since parameter", async () => {
    const { syncEvent } = await import("../services/sync.service");
    const fetch = mockFetch(makeDeltaResponse());
    mockGetMetadata.mockReturnValue("1699990000");

    await syncEvent(EVENT_ID, { ...BASE_DEPS, fetch });

    const [url] = fetch.mock.calls[0];
    expect(url).toContain("since=1699990000");
  });

  it("sends Authorization header with Bearer token", async () => {
    const { syncEvent } = await import("../services/sync.service");
    const fetch = mockFetch(makeDeltaResponse());

    await syncEvent(EVENT_ID, { ...BASE_DEPS, fetch });

    const [, options] = fetch.mock.calls[0];
    expect(options.headers["Authorization"]).toBe(
      `Bearer ${BASE_DEPS.apiKey}`
    );
  });
});

describe("syncEvent — processing", () => {
  it("calls upsertTickets with mapped ticket rows", async () => {
    const { syncEvent } = await import("../services/sync.service");
    const incomingTickets = [
      {
        ticket_id: "tkt-001",
        totp_secret_encrypted: btoa("secret"),
        totp_secret_iv: btoa("iv"),
        status: "active",
        holder_name: "Jan Novák",
        seat_info: "A1",
        synced_at: SERVER_TIME,
      },
    ];
    const fetch = mockFetch(makeDeltaResponse(incomingTickets));

    await syncEvent(EVENT_ID, { ...BASE_DEPS, fetch });

    expect(mockUpsertTickets).toHaveBeenCalledOnce();
    const [rows] = mockUpsertTickets.mock.calls[0];
    expect(rows).toHaveLength(1);
    expect(rows[0].ticket_id).toBe("tkt-001");
    expect(rows[0].totp_secret_encrypted).toBeInstanceOf(Uint8Array);
  });

  it("calls revokeTickets with deletedIds", async () => {
    const { syncEvent } = await import("../services/sync.service");
    const fetch = mockFetch(
      makeDeltaResponse([], ["tkt-del-1", "tkt-del-2"])
    );

    await syncEvent(EVENT_ID, { ...BASE_DEPS, fetch });

    expect(mockRevokeTickets).toHaveBeenCalledWith(["tkt-del-1", "tkt-del-2"]);
  });

  it("persists serverTime as new lastSyncAt", async () => {
    const { syncEvent } = await import("../services/sync.service");
    const fetch = mockFetch(makeDeltaResponse([], [], SERVER_TIME));

    await syncEvent(EVENT_ID, { ...BASE_DEPS, fetch });

    expect(mockSetMetadata).toHaveBeenCalledWith(
      `lastSyncAt:${EVENT_ID}`,
      String(SERVER_TIME)
    );
  });

  it("returns correct SyncResult counts", async () => {
    const { syncEvent } = await import("../services/sync.service");
    const tickets = Array.from({ length: 3 }, (_, i) => ({
      ticket_id: `tkt-00${i + 1}`,
      totp_secret_encrypted: btoa("s"),
      totp_secret_iv: btoa("v"),
      status: "active",
      holder_name: `User ${i}`,
      seat_info: `A${i}`,
      synced_at: SERVER_TIME, // synced_at == serverTime → counted as added
    }));
    mockCountCachedTickets.mockReturnValue(53);
    const fetch = mockFetch(makeDeltaResponse(tickets, ["del-1"]));

    const result = await syncEvent(EVENT_ID, { ...BASE_DEPS, fetch });

    expect(result.added).toBe(3);
    expect(result.updated).toBe(0);
    expect(result.deleted).toBe(1);
    expect(result.totalCached).toBe(53);
    expect(result.syncedAt).toBe(
      new Date(SERVER_TIME * 1000).toISOString()
    );
  });
});

describe("syncEvent — error handling", () => {
  it("throws on HTTP error and does not update lastSyncAt", async () => {
    const { syncEvent } = await import("../services/sync.service");
    const fetch = mockFetch({}, false, 500);

    await expect(syncEvent(EVENT_ID, { ...BASE_DEPS, fetch })).rejects.toThrow(
      "HTTP 500"
    );
    expect(mockSetMetadata).not.toHaveBeenCalled();
  });

  it("throws on network error and does not update lastSyncAt", async () => {
    const { syncEvent } = await import("../services/sync.service");
    const fetch = vi.fn().mockRejectedValue(new Error("Network request failed"));

    await expect(syncEvent(EVENT_ID, { ...BASE_DEPS, fetch })).rejects.toThrow(
      "Network request failed"
    );
    expect(mockSetMetadata).not.toHaveBeenCalled();
  });
});

describe("forcSync", () => {
  it("resets lastSyncAt to 0 before syncing", async () => {
    const { forcSync } = await import("../services/sync.service");
    const fetch = mockFetch(makeDeltaResponse());
    mockGetMetadata.mockReturnValue("1699990000");

    await forcSync(EVENT_ID, { ...BASE_DEPS, fetch });

    // First setMetadata call should reset to "0"
    const firstCall = mockSetMetadata.mock.calls[0];
    expect(firstCall).toEqual([`lastSyncAt:${EVENT_ID}`, "0"]);

    // URL should have since=0
    const [url] = fetch.mock.calls[0];
    expect(url).toContain("since=0");
  });

  it("persists the new serverTime after successful force sync", async () => {
    const { forcSync } = await import("../services/sync.service");
    const fetch = mockFetch(makeDeltaResponse([], [], SERVER_TIME));

    await forcSync(EVENT_ID, { ...BASE_DEPS, fetch });

    const lastCall =
      mockSetMetadata.mock.calls[mockSetMetadata.mock.calls.length - 1];
    expect(lastCall).toEqual([`lastSyncAt:${EVENT_ID}`, String(SERVER_TIME)]);
  });
});
