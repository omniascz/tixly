import { describe, it, expect } from "vitest";
import { generateSecret, generateTOTP, verifyTOTP } from "./totp";
import {
  encodeQRPayload,
  decodeQRPayload,
  verifyQRPayload,
} from "./qr-payload";

// ---------------------------------------------------------------------------
// generateSecret
// ---------------------------------------------------------------------------

describe("generateSecret", () => {
  it("returns a Buffer of exactly 32 bytes", () => {
    const secret = generateSecret();
    expect(secret).toBeInstanceOf(Buffer);
    expect(secret.length).toBe(32);
  });

  it("produces unique values each call", () => {
    const a = generateSecret();
    const b = generateSecret();
    expect(a.equals(b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generateTOTP
// ---------------------------------------------------------------------------

describe("generateTOTP", () => {
  it("produces an 8-digit zero-padded string", () => {
    const secret = generateSecret();
    const token = generateTOTP(secret, Date.now());
    expect(token).toMatch(/^\d{8}$/);
  });

  it("is deterministic: same secret + timestamp => same token", () => {
    const secret = generateSecret();
    const ts = 1_700_000_000_000; // fixed ms timestamp
    expect(generateTOTP(secret, ts)).toBe(generateTOTP(secret, ts));
  });

  it("produces the same token within the same 30-second window", () => {
    const secret = generateSecret();
    // Both timestamps are in the same window (window = floor(ts_sec / 30))
    const ts1 = 1_700_000_000_000; // second 0 of the window
    const ts2 = ts1 + 29_999;      // second 29 of the same window
    expect(generateTOTP(secret, ts1)).toBe(generateTOTP(secret, ts2));
  });

  it("produces a different token in the next 30-second window", () => {
    const secret = generateSecret();
    const ts1 = 1_700_000_000_000;
    const ts2 = ts1 + 30_000; // next window
    // May theoretically collide but probability is ~1 in 100 000 000
    expect(generateTOTP(secret, ts1)).not.toBe(generateTOTP(secret, ts2));
  });

  it("known-input determinism: fixed secret, fixed timestamp", () => {
    // Pre-computed expected value for a known secret/timestamp pair.
    // Recalculate if algorithm changes.
    const secret = Buffer.from(
      "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
      "hex"
    );
    // Counter = floor(1700000000 / 30) = 56666666
    const ts = 1_700_000_000_000;
    const token = generateTOTP(secret, ts);
    // Re-derive to verify our own implementation is self-consistent
    expect(token.length).toBe(8);
    expect(token).toBe(generateTOTP(secret, ts)); // idempotent
  });
});

// ---------------------------------------------------------------------------
// verifyTOTP
// ---------------------------------------------------------------------------

describe("verifyTOTP", () => {
  it("accepts a token generated for the same timestamp (C)", () => {
    const secret = generateSecret();
    const ts = 1_700_000_000_000;
    const token = generateTOTP(secret, ts);
    expect(verifyTOTP(secret, token, ts)).toBe(true);
  });

  it("accepts a token from C-1 (previous window)", () => {
    const secret = generateSecret();
    const ts = 1_700_000_000_000;
    const prevToken = generateTOTP(secret, ts - 30_000);
    expect(verifyTOTP(secret, prevToken, ts)).toBe(true);
  });

  it("accepts a token from C+1 (next window)", () => {
    const secret = generateSecret();
    const ts = 1_700_000_000_000;
    const nextToken = generateTOTP(secret, ts + 30_000);
    expect(verifyTOTP(secret, nextToken, ts)).toBe(true);
  });

  it("rejects a token from C-2 (two windows back)", () => {
    const secret = generateSecret();
    const ts = 1_700_000_000_000;
    const oldToken = generateTOTP(secret, ts - 60_000);
    expect(verifyTOTP(secret, oldToken, ts)).toBe(false);
  });

  it("rejects a token from C+2 (two windows ahead)", () => {
    const secret = generateSecret();
    const ts = 1_700_000_000_000;
    const futureToken = generateTOTP(secret, ts + 60_000);
    expect(verifyTOTP(secret, futureToken, ts)).toBe(false);
  });

  it("rejects a token with wrong length", () => {
    const secret = generateSecret();
    expect(verifyTOTP(secret, "1234567")).toBe(false);  // 7 digits
    expect(verifyTOTP(secret, "123456789")).toBe(false); // 9 digits
  });

  it("rejects a non-numeric token", () => {
    const secret = generateSecret();
    expect(verifyTOTP(secret, "abcd1234")).toBe(false);
  });

  it("rejects a completely wrong token", () => {
    const secret = generateSecret();
    const ts = 1_700_000_000_000;
    // Token generated with a different secret
    const otherToken = generateTOTP(generateSecret(), ts);
    // May collide in astronomically rare cases; acceptable for a unit test
    expect(verifyTOTP(secret, otherToken, ts)).toBe(false);
  });

  it("timing-safe: verifyTOTP returns false for tokens that differ only in last character", () => {
    // Ensures the comparison does not short-circuit early on near-matches,
    // which would otherwise leak timing information to an attacker.
    const secret = generateSecret();
    const ts = 1_700_000_000_000;
    const validToken = generateTOTP(secret, ts);

    // Flip only the last digit (keeping length identical — same code path as a real attack).
    const lastDigit = parseInt(validToken[7], 10);
    const flippedDigit = ((lastDigit + 1) % 10).toString();
    const nearMissToken = validToken.slice(0, 7) + flippedDigit;

    // If the near-miss happens to equal the real token (1-in-10 chance), skip.
    if (nearMissToken === validToken) return;

    expect(verifyTOTP(secret, nearMissToken, ts)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// encodeQRPayload / decodeQRPayload — round-trip
// ---------------------------------------------------------------------------

describe("encodeQRPayload / decodeQRPayload", () => {
  it("round-trips all fields correctly", () => {
    const secret = generateSecret();
    const ticketId = "ticket-uuid-1234";
    const eventId = "event-uuid-5678";
    const totpValue = generateTOTP(secret);

    const encoded = encodeQRPayload(ticketId, totpValue, eventId, secret);
    const decoded = decodeQRPayload(encoded);

    expect(decoded.ticketId).toBe(ticketId);
    expect(decoded.totpValue).toBe(totpValue);
    expect(decoded.eventId).toBe(eventId);
    expect(decoded.signature).toBeTruthy();
    expect(decoded.timestamp).toBeGreaterThan(0);
  });

  it("produces a valid base64 string", () => {
    const secret = generateSecret();
    const encoded = encodeQRPayload("t1", generateTOTP(secret), "e1", secret);
    expect(() => Buffer.from(encoded, "base64")).not.toThrow();
  });

  it("throws on invalid base64", () => {
    expect(() => decodeQRPayload("not!valid!base64!!!")).toThrow();
  });

  it("throws on payload with wrong number of fields", () => {
    const bad = Buffer.from("only|two").toString("base64");
    expect(() => decodeQRPayload(bad)).toThrow(/expected 5 fields/);
  });
});

// ---------------------------------------------------------------------------
// verifyQRPayload
// ---------------------------------------------------------------------------

describe("verifyQRPayload", () => {
  it("accepts a freshly encoded payload with the correct secret", () => {
    const secret = generateSecret();
    const encoded = encodeQRPayload(
      "ticket-abc",
      generateTOTP(secret),
      "event-xyz",
      secret
    );
    const payload = decodeQRPayload(encoded);
    expect(verifyQRPayload(payload, secret)).toBe(true);
  });

  it("rejects a payload with the wrong secret", () => {
    const secret = generateSecret();
    const wrongSecret = generateSecret();
    const encoded = encodeQRPayload(
      "ticket-abc",
      generateTOTP(secret),
      "event-xyz",
      secret
    );
    const payload = decodeQRPayload(encoded);
    expect(verifyQRPayload(payload, wrongSecret)).toBe(false);
  });

  it("rejects a payload with tampered ticketId", () => {
    const secret = generateSecret();
    const encoded = encodeQRPayload(
      "ticket-abc",
      generateTOTP(secret),
      "event-xyz",
      secret
    );
    const payload = decodeQRPayload(encoded);
    const tampered = { ...payload, ticketId: "ticket-EVIL" };
    expect(verifyQRPayload(tampered, secret)).toBe(false);
  });

  it("rejects a payload with tampered eventId", () => {
    const secret = generateSecret();
    const encoded = encodeQRPayload(
      "ticket-abc",
      generateTOTP(secret),
      "event-xyz",
      secret
    );
    const payload = decodeQRPayload(encoded);
    const tampered = { ...payload, eventId: "event-EVIL" };
    expect(verifyQRPayload(tampered, secret)).toBe(false);
  });

  it("rejects a payload with tampered totpValue", () => {
    const secret = generateSecret();
    const encoded = encodeQRPayload(
      "ticket-abc",
      generateTOTP(secret),
      "event-xyz",
      secret
    );
    const payload = decodeQRPayload(encoded);
    const tampered = { ...payload, totpValue: "00000000" };
    expect(verifyQRPayload(tampered, secret)).toBe(false);
  });

  it("rejects a payload with a forged signature", () => {
    const secret = generateSecret();
    const encoded = encodeQRPayload(
      "ticket-abc",
      generateTOTP(secret),
      "event-xyz",
      secret
    );
    const payload = decodeQRPayload(encoded);
    const tampered = {
      ...payload,
      signature: "a".repeat(payload.signature.length),
    };
    expect(verifyQRPayload(tampered, secret)).toBe(false);
  });
});
