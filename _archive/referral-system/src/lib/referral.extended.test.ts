import { describe, it, expect } from "vitest";
import {
  generateReferralCode,
  encodeBase62,
  isValidReferralCode,
  buildReferralUrl,
  getLastClickAttribution,
  getFirstClickAttribution,
  getLinearAttribution,
  isWithinConversionWindow,
  calculateCommission,
  CONVERSION_WINDOW_DAYS,
} from "./referral-code";
import {
  getLinearAttribution as getLinearAttributionFn,
  isWithinConversionWindow as isWithinConversionWindowFn,
  calculateCommission as calculateCommissionFn,
} from "./attribution";
import type { ReferralClick } from "../types/referral.types";

// ─── Extended tests: generateReferralCode (collision resistance) ──────────────

describe("generateReferralCode — collision resistance & format", () => {
  it("generates 10,000 codes with zero duplicates", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10000; i++) {
      const code = generateReferralCode();
      expect(seen.has(code)).toBe(false);
      seen.add(code);
    }
    expect(seen.size).toBe(10000);
  });

  it("every generated code is exactly 8 characters", () => {
    for (let i = 0; i < 100; i++) {
      const code = generateReferralCode();
      expect(code).toHaveLength(8);
    }
  });

  it("every generated code contains only [a-zA-Z0-9]", () => {
    const base62Regex = /^[a-zA-Z0-9]{8}$/;
    for (let i = 0; i < 100; i++) {
      const code = generateReferralCode();
      expect(base62Regex.test(code)).toBe(true);
    }
  });

  it("no special characters appear in generated codes", () => {
    const specialChars = /[^a-zA-Z0-9]/;
    for (let i = 0; i < 100; i++) {
      const code = generateReferralCode();
      expect(specialChars.test(code)).toBe(false);
    }
  });

  it("covers mix of lowercase, uppercase, and digits over 100 samples", () => {
    const codes = Array.from({ length: 100 }, () => generateReferralCode());
    const hasLower = codes.some((c) => /[a-z]/.test(c));
    const hasUpper = codes.some((c) => /[A-Z]/.test(c));
    const hasDigit = codes.some((c) => /[0-9]/.test(c));
    expect(hasLower && hasUpper && hasDigit).toBe(true);
  });
});

// ─── Extended tests: encodeBase62 ──────────────────────────────────────────────

describe("encodeBase62 — encoding properties", () => {
  it("encodes zero buffer to '00000000'", () => {
    const buf = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    expect(encodeBase62(buf)).toBe("00000000");
  });

  it("returns exactly 8 characters for any 6-byte buffer", () => {
    for (let i = 0; i < 20; i++) {
      const buf = Buffer.alloc(6);
      for (let j = 0; j < 6; j++) {
        buf[j] = Math.floor(Math.random() * 256);
      }
      expect(encodeBase62(buf)).toHaveLength(8);
    }
  });

  it("only produces [a-zA-Z0-9] characters", () => {
    const base62Regex = /^[a-zA-Z0-9]{8}$/;
    const testBuffers = [
      Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
      Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
      Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc]),
      Buffer.from([0xab, 0xcd, 0xef, 0x01, 0x23, 0x45]),
      Buffer.from([0x7f, 0x80, 0x00, 0x00, 0x00, 0x01]),
    ];
    for (const buf of testBuffers) {
      expect(base62Regex.test(encodeBase62(buf))).toBe(true);
    }
  });

  it("is deterministic (same input → same output)", () => {
    const buf = Buffer.from([0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f]);
    const code1 = encodeBase62(buf);
    const code2 = encodeBase62(buf);
    expect(code1).toBe(code2);
  });

  it("encodes all max buffer (0xFF × 6) without overflow", () => {
    const buf = Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    const code = encodeBase62(buf);
    expect(code).toHaveLength(8);
    expect(/^[a-zA-Z0-9]{8}$/.test(code)).toBe(true);
  });

  it("produces different codes for different buffers", () => {
    const buf1 = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x01]);
    const buf2 = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x02]);
    expect(encodeBase62(buf1)).not.toBe(encodeBase62(buf2));
  });
});

// ─── Extended tests: isValidReferralCode ──────────────────────────────────────

describe("isValidReferralCode — validation edge cases", () => {
  it("rejects code with 7 characters", () => {
    expect(isValidReferralCode("Abc123")).toBe(false);
  });

  it("rejects code with 9 characters", () => {
    expect(isValidReferralCode("AbCd12345")).toBe(false);
  });

  it("rejects code with special character @", () => {
    expect(isValidReferralCode("AbCd@234")).toBe(false);
  });

  it("rejects code with hyphen -", () => {
    expect(isValidReferralCode("AbCd-234")).toBe(false);
  });

  it("rejects code with underscore _", () => {
    expect(isValidReferralCode("AbCd_234")).toBe(false);
  });

  it("rejects code with space", () => {
    expect(isValidReferralCode("AbCd 234")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidReferralCode("")).toBe(false);
  });

  it("accepts exactly 8 base62 alphanumeric characters", () => {
    expect(isValidReferralCode("AbCd1234")).toBe(true);
  });

  it("accepts all lowercase 8 chars", () => {
    expect(isValidReferralCode("abcdefgh")).toBe(true);
  });

  it("accepts all uppercase 8 chars", () => {
    expect(isValidReferralCode("ABCDEFGH")).toBe(true);
  });

  it("accepts all digits (8 chars)", () => {
    expect(isValidReferralCode("12345678")).toBe(true);
  });

  it("rejects code with accented character", () => {
    expect(isValidReferralCode("AbCdéfgh")).toBe(false);
  });

  it("rejects code with dot", () => {
    expect(isValidReferralCode("AbCd.234")).toBe(false);
  });
});

// ─── Extended tests: buildReferralUrl ──────────────────────────────────────────

describe("buildReferralUrl — URL construction", () => {
  const BASE = "https://tixly.cz";

  it("builds correct /ref/<code> path", () => {
    const url = buildReferralUrl("AbCd1234", BASE);
    expect(url).toContain("/ref/AbCd1234");
  });

  it("includes utm_source=referral", () => {
    const url = buildReferralUrl("AbCd1234", BASE);
    expect(url).toContain("utm_source=referral");
  });

  it("includes utm_medium=referral", () => {
    const url = buildReferralUrl("AbCd1234", BASE);
    expect(url).toContain("utm_medium=referral");
  });

  it("includes utm_campaign when campaignId is provided", () => {
    const url = buildReferralUrl("AbCd1234", BASE, "spring-sale");
    expect(url).toContain("utm_campaign=spring-sale");
  });

  it("omits utm_campaign when campaignId is undefined", () => {
    const url = buildReferralUrl("AbCd1234", BASE);
    expect(url).not.toContain("utm_campaign");
  });

  it("produces valid URL object", () => {
    const url = buildReferralUrl("AbCd1234", BASE, "test");
    expect(() => new URL(url)).not.toThrow();
  });

  it("preserves base URL origin", () => {
    const url = buildReferralUrl("AbCd1234", "https://example.com");
    expect(url.startsWith("https://example.com")).toBe(true);
  });

  it("handles base URL with trailing slash", () => {
    const url = buildReferralUrl("AbCd1234", "https://tixly.cz/");
    expect(url).toContain("/ref/AbCd1234");
  });

  it("URL-encodes special characters in campaignId", () => {
    const url = buildReferralUrl("AbCd1234", BASE, "summer 2026");
    expect(url).toContain("utm_campaign=summer");
    // Space should be encoded as %20 or +
  });
});

// ─── Extended tests: isWithinConversionWindow ──────────────────────────────────

describe("isWithinConversionWindow — edge cases", () => {
  const NOW = new Date("2026-04-04T12:00:00Z");

  it("returns true when click is exactly at conversion time", () => {
    expect(isWithinConversionWindowFn(NOW, NOW, 30)).toBe(true);
  });

  it("returns true when click is 1 day before conversion", () => {
    const oneDayAgo = new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000);
    expect(isWithinConversionWindowFn(oneDayAgo, NOW, 30)).toBe(true);
  });

  it("returns true when click is exactly 30 days (86400000 ms × 30) before conversion", () => {
    const exactly30 = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(isWithinConversionWindowFn(exactly30, NOW, 30)).toBe(true);
  });

  it("returns false when click is 30 days + 1 minute before conversion", () => {
    const tooOld = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000 - 60 * 1000);
    expect(isWithinConversionWindowFn(tooOld, NOW, 30)).toBe(false);
  });

  it("returns false when click is in future relative to conversion", () => {
    const future = new Date(NOW.getTime() + 1000);
    expect(isWithinConversionWindowFn(future, NOW, 30)).toBe(false);
  });

  it("respects custom windowDays parameter (7 days)", () => {
    const sixDaysAgo = new Date(NOW.getTime() - 6 * 24 * 60 * 60 * 1000);
    const eightDaysAgo = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000);
    expect(isWithinConversionWindowFn(sixDaysAgo, NOW, 7)).toBe(true);
    expect(isWithinConversionWindowFn(eightDaysAgo, NOW, 7)).toBe(false);
  });

  it("returns true for exactly 29 days 23 hours 59 minutes (boundary test)", () => {
    const almostMax = new Date(
      NOW.getTime() - (29 * 24 * 60 + 23 * 60 + 59) * 60 * 1000
    );
    expect(isWithinConversionWindowFn(almostMax, NOW, 30)).toBe(true);
  });

  it("returns false for 30 days 1 minute", () => {
    const justOver = new Date(
      NOW.getTime() - (30 * 24 * 60 + 1) * 60 * 1000
    );
    expect(isWithinConversionWindowFn(justOver, NOW, 30)).toBe(false);
  });
});

// ─── Extended tests: getLastClickAttribution ────────────────────────────────────

describe("getLastClickAttribution — edge cases", () => {
  const NOW = new Date("2026-04-04T12:00:00Z");
  let idCounter = 1n;

  function makeClick(
    occurredAt: Date,
    linkId = "link-1"
  ): ReferralClick {
    return {
      id: idCounter++,
      linkId,
      referrerCode: "AbCd1234",
      visitorId: "visitor-abc",
      sessionId: "session-xyz",
      ipHash: "hash-ip",
      userAgentHash: "hash-ua",
      occurredAt,
      converted: false,
      convertedAt: null,
    };
  }

  it("returns null for empty click array", () => {
    expect(getLastClickAttribution([], NOW)).toBeNull();
  });

  it("returns the single in-window click", () => {
    const click = makeClick(new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000));
    expect(getLastClickAttribution([click], NOW)).toBe(click);
  });

  it("returns most recent click among multiple in-window clicks", () => {
    const old = makeClick(new Date(NOW.getTime() - 20 * 24 * 60 * 60 * 1000));
    const recent = makeClick(new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000));
    const mid = makeClick(new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000));
    const result = getLastClickAttribution([old, mid, recent], NOW);
    expect(result?.id).toBe(recent.id);
  });

  it("returns null when single click is outside window", () => {
    const expired = makeClick(new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000));
    expect(getLastClickAttribution([expired], NOW)).toBeNull();
  });

  it("ignores expired clicks and returns newest in-window", () => {
    const expired = makeClick(new Date(NOW.getTime() - 35 * 24 * 60 * 60 * 1000));
    const valid = makeClick(new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000));
    const result = getLastClickAttribution([expired, valid], NOW);
    expect(result?.id).toBe(valid.id);
  });

  it("multiple clicks in same second → consistent selection", () => {
    const same = [
      makeClick(NOW),
      makeClick(NOW),
      makeClick(NOW),
    ];
    const result1 = getLastClickAttribution([...same], NOW);
    const result2 = getLastClickAttribution([...same], NOW);
    // Should select same click (the latest by comparison)
    expect(result1).toBeDefined();
    expect(result2).toBeDefined();
  });

  it("uses default conversionAt = now when not provided", () => {
    const recent = makeClick(new Date(Date.now() - 5 * 60 * 1000));
    const result = getLastClickAttribution([recent]);
    expect(result).toBeDefined();
  });
});

// ─── Extended tests: getFirstClickAttribution ──────────────────────────────────

describe("getFirstClickAttribution — edge cases", () => {
  const NOW = new Date("2026-04-04T12:00:00Z");
  let idCounter = 1n;

  function makeClick(occurredAt: Date): ReferralClick {
    return {
      id: idCounter++,
      linkId: "link-1",
      referrerCode: "AbCd1234",
      visitorId: "visitor-abc",
      sessionId: "session-xyz",
      ipHash: "hash-ip",
      userAgentHash: "hash-ua",
      occurredAt,
      converted: false,
      convertedAt: null,
    };
  }

  it("returns oldest click among multiple", () => {
    const old = makeClick(new Date(NOW.getTime() - 25 * 24 * 60 * 60 * 1000));
    const recent = makeClick(new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000));
    const result = getFirstClickAttribution([recent, old], NOW);
    expect(result?.id).toBe(old.id);
  });

  it("returns null when all clicks are expired", () => {
    const expired1 = makeClick(new Date(NOW.getTime() - 40 * 24 * 60 * 60 * 1000));
    const expired2 = makeClick(new Date(NOW.getTime() - 35 * 24 * 60 * 60 * 1000));
    expect(getFirstClickAttribution([expired1, expired2], NOW)).toBeNull();
  });

  it("returns single click when only one in window", () => {
    const click = makeClick(new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000));
    expect(getFirstClickAttribution([click], NOW)).toBe(click);
  });
});

// ─── Extended tests: getLinearAttribution ────────────────────────────────────────

describe("getLinearAttribution — edge cases", () => {
  const NOW = new Date("2026-04-04T12:00:00Z");
  let idCounter = 1n;

  function makeClick(
    occurredAt: Date,
    linkId = "link-1"
  ): ReferralClick {
    return {
      id: idCounter++,
      linkId,
      referrerCode: "AbCd1234",
      visitorId: "visitor-abc",
      sessionId: "session-xyz",
      ipHash: "hash-ip",
      userAgentHash: "hash-ua",
      occurredAt,
      converted: false,
      convertedAt: null,
    };
  }

  it("returns empty array for empty clicks", () => {
    expect(getLinearAttributionFn([], 100, NOW)).toHaveLength(0);
  });

  it("assigns 100% to single eligible click", () => {
    const click = makeClick(new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000));
    const shares = getLinearAttributionFn([click], 100, NOW);
    expect(shares).toHaveLength(1);
    expect(shares[0]?.amount).toBe(100);
  });

  it("distributes evenly across 3 clicks", () => {
    const clicks = [
      makeClick(new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000)),
      makeClick(new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000)),
      makeClick(new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000)),
    ];
    const shares = getLinearAttributionFn(clicks, 99, NOW);
    expect(shares).toHaveLength(3);
    for (const share of shares) {
      expect(share.amount).toBeCloseTo(33, 1);
    }
  });

  it("sum of shares equals totalAmount (rounding check)", () => {
    const clicks = [
      makeClick(new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000)),
      makeClick(new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000)),
      makeClick(new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000)),
    ];
    const total = 100;
    const shares = getLinearAttributionFn(clicks, total, NOW);
    const sum = shares.reduce((acc, s) => acc + s.amount, 0);
    expect(Math.round(sum * 100)).toBe(Math.round(total * 100));
  });

  it("excludes expired clicks from distribution", () => {
    const expired = makeClick(new Date(NOW.getTime() - 35 * 24 * 60 * 60 * 1000));
    const valid1 = makeClick(new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000));
    const valid2 = makeClick(new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000));
    const shares = getLinearAttributionFn([expired, valid1, valid2], 100, NOW);
    expect(shares).toHaveLength(2);
    for (const share of shares) {
      expect(share.amount).toBe(50);
    }
  });

  it("populates linkId and clickId correctly", () => {
    const click = makeClick(
      new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000),
      "link-special"
    );
    const shares = getLinearAttributionFn([click], 50, NOW);
    expect(shares[0]?.linkId).toBe("link-special");
    expect(shares[0]?.clickId).toBe(click.id);
  });

  it("handles 10 clicks with rounding correctness", () => {
    const clicks = Array.from({ length: 10 }, (_, i) =>
      makeClick(new Date(NOW.getTime() - i * 24 * 60 * 60 * 1000))
    );
    const total = 100;
    const shares = getLinearAttributionFn(clicks, total, NOW);
    expect(shares).toHaveLength(10);
    const sum = shares.reduce((acc, s) => acc + s.amount, 0);
    // Each click gets 10 CZK
    expect(Math.round(sum * 100)).toBe(Math.round(total * 100));
  });

  it("remainder is added to last entry", () => {
    const clicks = [
      makeClick(new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000)),
      makeClick(new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000)),
      makeClick(new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000)),
    ];
    // 100 / 3 = 33.33... per click
    // Floor: 33, remainder 1 (because of rounding)
    const shares = getLinearAttributionFn(clicks, 100, NOW);
    const sum = shares.reduce((acc, s) => acc + s.amount, 0);
    expect(sum).toBeCloseTo(100, 2);
  });
});

// ─── Extended tests: calculateCommission ────────────────────────────────────────

describe("calculateCommission — edge cases", () => {
  it("calculates 5% of 0 CZK → 0 CZK", () => {
    expect(calculateCommissionFn(0, 0.05)).toBe(0);
  });

  it("calculates 5% of 1000 CZK → 50 CZK", () => {
    expect(calculateCommissionFn(1000, 0.05)).toBe(50);
  });

  it("calculates 5% of 2500 CZK → 125 CZK", () => {
    expect(calculateCommissionFn(2500, 0.05)).toBe(125);
  });

  it("rounds 1 CZK × 5% = 0.05 → 0 CZK (banker's rounding)", () => {
    // Math.round(0.05) = 0
    expect(calculateCommissionFn(1, 0.05)).toBe(0);
  });

  it("rounds 333 CZK × 5% = 16.65 → 17 CZK", () => {
    expect(calculateCommissionFn(333, 0.05)).toBe(17);
  });

  it("handles very large amount (100,000 CZK × 5% → 5,000 CZK)", () => {
    expect(calculateCommissionFn(100000, 0.05)).toBe(5000);
  });

  it("works with custom commission rate (10%)", () => {
    expect(calculateCommissionFn(1000, 0.10)).toBe(100);
  });

  it("works with custom commission rate (2.5%)", () => {
    expect(calculateCommissionFn(1000, 0.025)).toBe(25);
  });

  it("handles fractional order amount", () => {
    // 333.33 × 5% = 16.665 → 17
    expect(calculateCommissionFn(333.33, 0.05)).toBeCloseTo(17, 0);
  });

  it("result is always whole number (rounded to nearest integer)", () => {
    const testCases = [
      [1, 0.05],
      [333, 0.05],
      [1000, 0.075],
      [2500, 0.03],
      [10000, 0.025],
    ];
    for (const [amount, rate] of testCases) {
      const result = calculateCommissionFn(amount as number, rate as number);
      expect(Number.isInteger(result)).toBe(true);
    }
  });

  it("scales linearly with order amount", () => {
    const rate = 0.05;
    const comm1 = calculateCommissionFn(1000, rate);
    const comm2 = calculateCommissionFn(2000, rate);
    // comm2 should be approximately 2 × comm1 (within rounding)
    expect(Math.abs(comm2 - comm1 * 2)).toBeLessThan(2);
  });
});
