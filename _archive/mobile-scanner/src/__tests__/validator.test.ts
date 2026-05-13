// ---------------------------------------------------------------------------
// validator.test.ts — full coverage of offline validator
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock expo-sqlite so offline-cache.ts initialises cleanly
vi.mock("expo-sqlite", () => import("./__mocks__/expo-sqlite"));

// ---------------------------------------------------------------------------
// Helpers to build a deterministic QR payload without real HMAC/TOTP
// ---------------------------------------------------------------------------

function toBase64(str: string): string {
  return Buffer.from(str, "utf8").toString("base64");
}

function buildRawPayload(
  ticketId: string,
  totpValue: string,
  timestamp: number,
  eventId: string,
  signature: string
): string {
  return toBase64(`${ticketId}|${totpValue}|${timestamp}|${eventId}|${signature}`);
}

const NOW_SEC = Math.floor(Date.now() / 1000);

// Shared test secret (plain bytes — injected via decryptSecret mock)
const TEST_SECRET = new Uint8Array(32).fill(0xab);

// ---------------------------------------------------------------------------
// Mock all dependencies of validateOffline
// ---------------------------------------------------------------------------

const mockGetTicket = vi.fn();
const mockMarkAsScanned = vi.fn();
const mockRecordScannedToken = vi.fn();
const mockVerifyQRPayload = vi.fn();
const mockVerifyTOTP = vi.fn();
const mockDecodeQRPayload = vi.fn();

vi.mock("../db/offline-cache", () => ({
  getTicket: mockGetTicket,
  markAsScanned: mockMarkAsScanned,
  recordScannedToken: mockRecordScannedToken,
}));

vi.mock("../lib/qr-payload", () => ({
  decodeQRPayload: mockDecodeQRPayload,
  verifyQRPayload: mockVerifyQRPayload,
}));

vi.mock("../lib/totp", () => ({
  verifyTOTP: mockVerifyTOTP,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EVENT_ID = "event-abc";
const TICKET_ID = "tkt-001";
const TOTP_VALUE = "12345678";

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    ticketId: TICKET_ID,
    totpValue: TOTP_VALUE,
    timestamp: NOW_SEC,
    eventId: EVENT_ID,
    signature: "aaaa1111",
    ...overrides,
  };
}

function activeTicketRow(overrides: Record<string, unknown> = {}) {
  return {
    ticket_id: TICKET_ID,
    totp_secret_encrypted: new Uint8Array([1]),
    totp_secret_iv: new Uint8Array([2]),
    status: "active",
    holder_name: "Jan Novák",
    seat_info: "Sector A, Row 3, Seat 12",
    synced_at: NOW_SEC - 60,
    ...overrides,
  };
}

/** Injectable decryptSecret that always returns TEST_SECRET */
const mockDecryptSecret = vi.fn().mockResolvedValue(TEST_SECRET);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockDecodeQRPayload.mockReturnValue(validPayload());
  mockGetTicket.mockReturnValue(activeTicketRow());
  mockVerifyQRPayload.mockResolvedValue(true);
  mockVerifyTOTP.mockResolvedValue(true);
  mockRecordScannedToken.mockReturnValue(true);
});

describe("validateOffline — happy path", () => {
  it("returns success with holderName and seatInfo for a valid QR", async () => {
    const { validateOffline } = await import("../services/validator.service");
    const result = await validateOffline("encoded-qr", EVENT_ID, {
      decryptSecret: mockDecryptSecret,
    });
    expect(result.success).toBe(true);
    expect(result.ticketId).toBe(TICKET_ID);
    expect(result.holderName).toBe("Jan Novák");
    expect(result.seatInfo).toBe("Sector A, Row 3, Seat 12");
    expect(mockMarkAsScanned).toHaveBeenCalledWith(TICKET_ID, expect.any(Date));
  });
});

describe("validateOffline — decode failures", () => {
  it("returns 'Invalid QR code' when decodeQRPayload throws", async () => {
    const { validateOffline } = await import("../services/validator.service");
    mockDecodeQRPayload.mockImplementation(() => {
      throw new Error("bad base64");
    });
    const result = await validateOffline("bad", EVENT_ID, {
      decryptSecret: mockDecryptSecret,
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid QR code");
  });
});

describe("validateOffline — event mismatch", () => {
  it("returns 'Wrong event' when eventId does not match", async () => {
    const { validateOffline } = await import("../services/validator.service");
    mockDecodeQRPayload.mockReturnValue(
      validPayload({ eventId: "event-other" })
    );
    const result = await validateOffline("encoded-qr", EVENT_ID, {
      decryptSecret: mockDecryptSecret,
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Wrong event");
  });
});

describe("validateOffline — expiry", () => {
  it("returns 'QR code expired' when timestamp is more than 90s old", async () => {
    const { validateOffline } = await import("../services/validator.service");
    mockDecodeQRPayload.mockReturnValue(
      validPayload({ timestamp: NOW_SEC - 100 })
    );
    const result = await validateOffline("encoded-qr", EVENT_ID, {
      decryptSecret: mockDecryptSecret,
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("QR code expired");
  });

  it("accepts QR codes within 90s window", async () => {
    const { validateOffline } = await import("../services/validator.service");
    mockDecodeQRPayload.mockReturnValue(
      validPayload({ timestamp: NOW_SEC - 89 })
    );
    const result = await validateOffline("encoded-qr", EVENT_ID, {
      decryptSecret: mockDecryptSecret,
    });
    expect(result.success).toBe(true);
  });
});

describe("validateOffline — ticket not found", () => {
  it("returns 'Ticket not found in local cache' when getTicket returns null", async () => {
    const { validateOffline } = await import("../services/validator.service");
    mockGetTicket.mockReturnValue(null);
    const result = await validateOffline("encoded-qr", EVENT_ID, {
      decryptSecret: mockDecryptSecret,
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Ticket not found in local cache");
  });
});

describe("validateOffline — ticket status", () => {
  it("returns 'Ticket revoked' for a revoked ticket", async () => {
    const { validateOffline } = await import("../services/validator.service");
    mockGetTicket.mockReturnValue(activeTicketRow({ status: "revoked" }));
    const result = await validateOffline("encoded-qr", EVENT_ID, {
      decryptSecret: mockDecryptSecret,
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Ticket revoked");
  });

  it("returns 'Ticket already used' for a used ticket", async () => {
    const { validateOffline } = await import("../services/validator.service");
    mockGetTicket.mockReturnValue(activeTicketRow({ status: "used" }));
    const result = await validateOffline("encoded-qr", EVENT_ID, {
      decryptSecret: mockDecryptSecret,
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Ticket already used");
  });
});

describe("validateOffline — decryption failure", () => {
  it("returns 'Secret decryption failed' when decryptSecret rejects", async () => {
    const { validateOffline } = await import("../services/validator.service");
    const failingDecrypt = vi.fn().mockRejectedValue(new Error("AES error"));
    const result = await validateOffline("encoded-qr", EVENT_ID, {
      decryptSecret: failingDecrypt,
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Secret decryption failed");
  });

  it("accepts an injected mock decryptSecret returning test secret", async () => {
    const { validateOffline } = await import("../services/validator.service");
    const result = await validateOffline("encoded-qr", EVENT_ID, {
      decryptSecret: mockDecryptSecret,
    });
    expect(mockDecryptSecret).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});

describe("validateOffline — HMAC signature", () => {
  it("returns 'Invalid signature' when verifyQRPayload returns false", async () => {
    const { validateOffline } = await import("../services/validator.service");
    mockVerifyQRPayload.mockResolvedValue(false);
    const result = await validateOffline("encoded-qr", EVENT_ID, {
      decryptSecret: mockDecryptSecret,
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid signature");
  });
});

describe("validateOffline — TOTP", () => {
  it("returns 'Invalid TOTP code' when verifyTOTP returns false", async () => {
    const { validateOffline } = await import("../services/validator.service");
    mockVerifyTOTP.mockResolvedValue(false);
    const result = await validateOffline("encoded-qr", EVENT_ID, {
      decryptSecret: mockDecryptSecret,
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid TOTP code");
  });
});

describe("validateOffline — anti-replay", () => {
  it("returns 'Already scanned' when recordScannedToken returns false", async () => {
    const { validateOffline } = await import("../services/validator.service");
    mockRecordScannedToken.mockReturnValue(false);
    const result = await validateOffline("encoded-qr", EVENT_ID, {
      decryptSecret: mockDecryptSecret,
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Already scanned");
  });

  it("does not call markAsScanned on duplicate scan", async () => {
    const { validateOffline } = await import("../services/validator.service");
    mockRecordScannedToken.mockReturnValue(false);
    await validateOffline("encoded-qr", EVENT_ID, {
      decryptSecret: mockDecryptSecret,
    });
    expect(mockMarkAsScanned).not.toHaveBeenCalled();
  });
});
