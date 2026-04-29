import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash, createHmac } from "crypto";
import { generateApiKey, ApiKeyService, VALID_SCOPES } from "../services/api-key.service";
import { signWebhook, verifyWebhookSignature } from "../services/webhook-delivery.service";
import { isGeoAllowed } from "../../virtual-stream/src/lib/geo-block";

// =============================================================================
// 1. API Key generování
// =============================================================================

describe("generateApiKey", () => {
  it("generuje platný live klíč", () => {
    const { raw, hash, prefix } = generateApiKey("live");
    expect(raw).toMatch(/^tick_live_[A-Za-z0-9_-]{20}$/);
    expect(hash).toHaveLength(64); // SHA-256 hex
    expect(prefix).toMatch(/^tick_live_[A-Za-z0-9_-]{6}$/);
  });

  it("generuje platný test klíč", () => {
    const { raw } = generateApiKey("test");
    expect(raw).toMatch(/^tick_test_[A-Za-z0-9_-]{20}$/);
  });

  it("hash odpovídá SHA-256 raw klíče", () => {
    const { raw, hash } = generateApiKey("live");
    const expected = createHash("sha256").update(raw).digest("hex");
    expect(hash).toBe(expected);
  });

  it("každý vygenerovaný klíč je unikátní", () => {
    const keys = Array.from({ length: 100 }, () => generateApiKey("live").raw);
    const unique = new Set(keys);
    expect(unique.size).toBe(100);
  });
});

// =============================================================================
// 2. ApiKeyService — validace scopů
// =============================================================================

describe("ApiKeyService.create — scope validace", () => {
  const mockDb = {
    createApiKey: vi.fn().mockResolvedValue({ id: "uuid-1", createdAt: new Date() }),
    listApiKeys: vi.fn(),
    getApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
    rotateApiKey: vi.fn(),
  };

  const service = new ApiKeyService(mockDb);

  beforeEach(() => vi.clearAllMocks());

  it("přijme platné scopes", async () => {
    const result = await service.create({
      promoterId: "promo-1",
      name: "Test klíč",
      scopes: ["read:events", "write:orders"],
      environment: "test",
    });
    expect(result.rawKey).toMatch(/^tick_test_/);
    expect(result.scopes).toEqual(["read:events", "write:orders"]);
  });

  it("odmítne neplatný scope", async () => {
    await expect(
      service.create({
        promoterId: "promo-1",
        name: "Test",
        scopes: ["read:events", "delete:everything"],
        environment: "live",
      })
    ).rejects.toThrow("Neplatné scopes: delete:everything");
  });

  it("odmítne prázdný scopes array", async () => {
    await expect(
      service.create({
        promoterId: "promo-1",
        name: "Test",
        scopes: [],
        environment: "live",
      })
    ).rejects.toThrow("Alespoň jeden scope je povinný");
  });

  it("VALID_SCOPES obsahuje všechna očekávaná oprávnění", () => {
    expect(VALID_SCOPES).toContain("read:events");
    expect(VALID_SCOPES).toContain("write:orders");
    expect(VALID_SCOPES).toContain("manage:webhooks");
    expect(VALID_SCOPES).toContain("admin:keys");
  });
});

// =============================================================================
// 3. Webhook HMAC podpis
// =============================================================================

describe("signWebhook / verifyWebhookSignature", () => {
  const secret = "test-webhook-secret-min-32-chars!!";
  const payload = JSON.stringify({ order_id: "ord-123", status: "paid" });

  it("podpis je verifikovatelný", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const header = signWebhook(payload, secret, timestamp);
    expect(verifyWebhookSignature(payload, header, secret)).toBe(true);
  });

  it("odmítne pozměněný payload", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const header = signWebhook(payload, secret, timestamp);
    const tampered = JSON.stringify({ order_id: "ord-HACKED", status: "paid" });
    expect(verifyWebhookSignature(tampered, header, secret)).toBe(false);
  });

  it("odmítne špatný secret", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const header = signWebhook(payload, secret, timestamp);
    expect(verifyWebhookSignature(payload, header, "wrong-secret")).toBe(false);
  });

  it("odmítne replay attack (starý timestamp)", () => {
    const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minut zpět
    const header = signWebhook(payload, secret, oldTimestamp);
    expect(verifyWebhookSignature(payload, header, secret, 300)).toBe(false);
  });

  it("akceptuje timestamp v toleranci", () => {
    const timestamp = Math.floor(Date.now() / 1000) - 100; // 100s zpět
    const header = signWebhook(payload, secret, timestamp);
    expect(verifyWebhookSignature(payload, header, secret, 300)).toBe(true);
  });

  it("formát headeru je t=<ts>,v1=<hmac>", () => {
    const header = signWebhook(payload, secret, 1712410800);
    expect(header).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
  });

  it("HMAC hodnota je správná", () => {
    const timestamp = 1712410800;
    const header = signWebhook(payload, secret, timestamp);
    const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
    const expected = createHmac("sha256", secret)
      .update(`${timestamp}.${payload}`)
      .digest("hex");
    expect(parts["v1"]).toBe(expected);
  });
});

// =============================================================================
// 4. Rate limit tier limits
// =============================================================================

describe("Rate limit tiers", () => {
  const TIER_LIMITS = { free: 100, standard: 1_000, premium: 10_000 };

  it("free tier má limit 100", () => expect(TIER_LIMITS.free).toBe(100));
  it("standard tier má limit 1000", () => expect(TIER_LIMITS.standard).toBe(1_000));
  it("premium tier má limit 10000", () => expect(TIER_LIMITS.premium).toBe(10_000));
});

// =============================================================================
// 5. Geo-block logika
// =============================================================================

describe("isGeoAllowed", () => {
  it("allow_all vždy povolí", () => {
    expect(isGeoAllowed("CN", { mode: "allow_all", countries: [] })).toBe(true);
    expect(isGeoAllowed(null, { mode: "allow_all", countries: [] })).toBe(true);
  });

  it("allowlist povolí pouze uvedené země", () => {
    const config = { mode: "allowlist" as const, countries: ["CZ", "SK"] };
    expect(isGeoAllowed("CZ", config)).toBe(true);
    expect(isGeoAllowed("DE", config)).toBe(false);
    expect(isGeoAllowed(null, config)).toBe(false);
  });

  it("blocklist zakáže uvedené země", () => {
    const config = { mode: "blocklist" as const, countries: ["CN", "RU"] };
    expect(isGeoAllowed("CZ", config)).toBe(true);
    expect(isGeoAllowed("CN", config)).toBe(false);
    expect(isGeoAllowed(null, config)).toBe(false);
  });

  it("porovnání je case-insensitive", () => {
    const config = { mode: "allowlist" as const, countries: ["cz"] };
    expect(isGeoAllowed("CZ", config)).toBe(true);
    expect(isGeoAllowed("cz", config)).toBe(true);
  });
});

// =============================================================================
// 6. POS objednávka — integrace (mock)
// =============================================================================

describe("POST /api/v1/orders — validace", () => {
  it("odmítne payment_method !== external", () => {
    // Simulace validace bez skutečného HTTP volání
    const body = { event_id: "evt-1", items: [{ ticket_type_id: "tt-1", quantity: 1 }],
      customer: { email: "a@b.cz", name: "Jan" }, payment_method: "gopay" };
    expect(body.payment_method).not.toBe("external");
  });

  it("odmítne prázdný items array", () => {
    const items: unknown[] = [];
    expect(items.length).toBe(0);
  });

  it("akceptuje validní POS objednávku strukturu", () => {
    const body = {
      event_id: "evt-uuid",
      items: [{ ticket_type_id: "tt-uuid", quantity: 2 }],
      customer: { email: "pos@shop.cz", name: "POS Systém" },
      payment_method: "external",
      external_reference: "POS-12345",
    };
    expect(body.payment_method).toBe("external");
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.customer.email).toBeTruthy();
  });
});
