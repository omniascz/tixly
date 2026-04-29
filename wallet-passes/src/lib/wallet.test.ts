/**
 * Vitest unit tests for the wallet-passes module.
 *
 * Test coverage:
 *  1. AppleWalletService.generatePass — output is a valid ZIP Buffer with
 *     required files (pass.json, manifest.json).
 *  2. GoogleWalletService.generatePassJWT — returns a 3-part RS256 JWT string.
 *  3. WalletService.pushUpdateOnQRChange — fans out to both platform services.
 *  4. WalletService.issueWalletPass — Apple returns downloadUrl, Google returns addToWalletUrl.
 *  5. Apple registration flow — register → getUpdatedSerials → unregister.
 *
 * All external dependencies (DB, HTTP) are provided as in-memory stubs so the
 * tests run without any real certificates or network access.
 *
 * To run: `vitest run` (or `npm test`) from the wallet-passes directory.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import JSZip from "jszip";

// ---------------------------------------------------------------------------
// Module imports (these are the units under test)
// ---------------------------------------------------------------------------

import {
  AppleWalletService,
  type AppleWalletDBAdapter,
  type HttpClient as AppleHttpClient,
} from "../services/apple-wallet.service.js";

import {
  GoogleWalletService,
  type GoogleHttpClient,
} from "../services/google-wallet.service.js";

import {
  WalletService,
  type WalletDBAdapter,
  type TicketForWallet,
  type EventForWallet,
} from "../services/wallet.service.js";

import type {
  ApplePassData,
  GooglePassData,
  ApplePassRegistration,
  WalletPass,
} from "../types/wallet.js";

// ---------------------------------------------------------------------------
// Minimal valid P12 / RSA stubs
// ---------------------------------------------------------------------------

/**
 * Tests that exercise PKCS#7 signing require a real P12 bundle.
 * Here we set the relevant ENV vars to empty values and mock the signing
 * function so the tests focus on ZIP structure and JWT shape rather than
 * cryptographic correctness (which is covered by node-forge's own test suite).
 */

// Mock node-forge for Apple signing tests (replaces actual crypto calls)
vi.mock("node-forge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node-forge")>();
  return {
    ...actual,
    pkcs12: {
      ...actual.pkcs12,
      pkcs12FromAsn1: vi.fn(() => ({
        getBags: vi.fn((opts: { bagType: string }) => {
          if (opts.bagType === actual.pki.oids.pkcs8ShroudedKeyBag) {
            return {
              [actual.pki.oids.pkcs8ShroudedKeyBag]: [
                {
                  key: {
                    sign: vi.fn(() => "fakesignature"),
                  },
                },
              ],
            };
          }
          if (opts.bagType === actual.pki.oids.certBag) {
            const fakeCert = {
              subject: { attributes: [] },
              issuer: { attributes: [] },
            } as unknown as import("node-forge").pki.Certificate;
            return {
              [actual.pki.oids.certBag]: [{ cert: fakeCert }],
            };
          }
          return {};
        }),
      })),
    },
    pkcs7: {
      createSignedData: vi.fn(() => ({
        content: null,
        addCertificate: vi.fn(),
        addSigner: vi.fn(),
        sign: vi.fn(),
        toAsn1: vi.fn(() => ({})),
      })),
    },
    asn1: {
      ...actual.asn1,
      fromDer: vi.fn(() => ({})),
      toDer: vi.fn(() => ({ getBytes: () => "fakeSignatureBytes" })),
    },
    util: {
      ...actual.util,
      decode64: vi.fn(() => "fakeP12Der"),
      createBuffer: vi.fn((content: string) => actual.util.createBuffer(content)),
    },
    pki: {
      ...actual.pki,
      privateKeyFromPem: vi.fn(() => ({
        sign: vi.fn(() => "fakesig"),
      })),
      privateKeyToPem: vi.fn(() => "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----"),
    },
    md: {
      ...actual.md,
      sha256: {
        create: vi.fn(() => ({
          update: vi.fn().mockReturnThis(),
        })),
      },
    },
  };
});

// ---------------------------------------------------------------------------
// Stub builders
// ---------------------------------------------------------------------------

function makeApplePassData(overrides?: Partial<ApplePassData>): ApplePassData {
  return {
    eventTitle: "Testovací Akce",
    venueName: "O2 Arena Praha",
    eventDate: "2026-06-15",
    eventTime: "19:30",
    holderName: "Jana Nováková",
    seatInfo: "Sekce A, řada 3, sedadlo 12",
    ticketType: "Standard",
    qrMessage: "dGlja2V0SWR8dG90cFZhbHVlfHRpbWVzdGFtcHxldmVudElkfHNpZw==",
    ...overrides,
  };
}

function makeGooglePassData(overrides?: Partial<GooglePassData>): GooglePassData {
  return {
    eventTitle: "Testovací Akce",
    venueName: "O2 Arena Praha",
    eventDate: "2026-06-15",
    eventTime: "19:30",
    holderName: "Jana Nováková",
    seatInfo: "Sekce A, řada 3, sedadlo 12",
    seatNumber: "12",
    row: "3",
    section: "A",
    ticketType: "Standard",
    qrMessage: "dGlja2V0SWR8dG90cFZhbHVlfHRpbWVzdGFtcHxldmVudElkfHNpZw==",
    eventId: "event-uuid-001",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// In-memory stub implementations
// ---------------------------------------------------------------------------

class StubAppleDB implements AppleWalletDBAdapter {
  private registrations: ApplePassRegistration[] = [];
  private authTokens: Map<string, string> = new Map([
    ["ticket-test-ticket-001", "validtoken123"],
  ]);

  async getRegistrations(serialNumber: string): Promise<ApplePassRegistration[]> {
    return this.registrations.filter((r) => r.serialNumber === serialNumber);
  }
  async upsertRegistration(reg: Omit<ApplePassRegistration, "id">): Promise<void> {
    const existing = this.registrations.findIndex(
      (r) =>
        r.deviceLibraryIdentifier === reg.deviceLibraryIdentifier &&
        r.serialNumber === reg.serialNumber
    );
    if (existing >= 0) {
      this.registrations[existing] = { id: `id-${Date.now()}`, ...reg };
    } else {
      this.registrations.push({ id: `id-${Date.now()}`, ...reg });
    }
  }
  async deleteRegistration(
    deviceLibraryIdentifier: string,
    serialNumber: string
  ): Promise<void> {
    this.registrations = this.registrations.filter(
      (r) =>
        !(
          r.deviceLibraryIdentifier === deviceLibraryIdentifier &&
          r.serialNumber === serialNumber
        )
    );
  }
  async getUpdatedSerials(
    _passTypeIdentifier: string,
    _deviceId: string,
    since: Date
  ): Promise<string[]> {
    // Return all serials registered after `since` for test purposes
    return this.registrations
      .filter((r) => r.registeredAt > since)
      .map((r) => r.serialNumber);
  }
  async getAuthToken(serialNumber: string): Promise<string | null> {
    return this.authTokens.get(serialNumber) ?? null;
  }
}

class StubAppleHttp implements AppleHttpClient {
  readonly calls: Array<{ url: string; body: string }> = [];
  async post(
    url: string,
    _headers: Record<string, string>,
    body: string
  ): Promise<{ statusCode: number; body: string }> {
    this.calls.push({ url, body });
    return { statusCode: 200, body: "{}" };
  }
}

class StubGoogleHttp implements GoogleHttpClient {
  readonly getCalls: string[] = [];
  readonly postCalls: string[] = [];
  readonly patchCalls: string[] = [];

  // Simulate: class doesn't exist yet (404 on GET) → POST creates it (200)
  async get(_url: string): Promise<{ statusCode: number; body: string }> {
    this.getCalls.push(_url);
    return { statusCode: 404, body: "{}" };
  }
  async post(
    url: string,
    _headers: Record<string, string>,
    body: string
  ): Promise<{ statusCode: number; body: string }> {
    this.postCalls.push(url);
    // Handle OAuth token exchange
    if (url.includes("oauth2.googleapis.com")) {
      return {
        statusCode: 200,
        body: JSON.stringify({ access_token: "fake-access-token", expires_in: 3600 }),
      };
    }
    return { statusCode: 200, body: JSON.stringify({ id: "fake-object-id" }) };
  }
  async patch(
    url: string,
    _headers: Record<string, string>,
    _body: string
  ): Promise<{ statusCode: number; body: string }> {
    this.patchCalls.push(url);
    return { statusCode: 200, body: "{}" };
  }
}

function makeStubWalletDB(): WalletDBAdapter & { passRecord: WalletPass | null } {
  let passRecord: WalletPass | null = null;

  const ticket: TicketForWallet = {
    ticketId: "ticket-001",
    eventId: "event-001",
    userId: "user-001",
    holderName: "Jana Nováková",
    seatInfo: "Sekce A, řada 3, sedadlo 12",
    seatNumber: "12",
    row: "3",
    section: "A",
    ticketType: "Standard",
    totpSecretEncrypted: Buffer.alloc(32),
    totpSecretIv: Buffer.alloc(16),
  };

  const event: EventForWallet = {
    eventId: "event-001",
    title: "Testovací Akce",
    venueName: "O2 Arena Praha",
    eventDate: "2026-06-15",
    eventTime: "19:30",
  };

  return {
    get passRecord() { return passRecord; },
    async getTicket(id) { return id === ticket.ticketId ? ticket : null; },
    async getEvent(id) { return id === event.eventId ? event : null; },
    async getPass() { return passRecord; },
    async upsertPass(pass) {
      passRecord = { id: "pass-001", ...pass, createdAt: pass.createdAt, updatedAt: pass.updatedAt };
      return passRecord;
    },
    async updatePassTimestamp() { /* no-op in tests */ },
    async generateDownloadUrl(serial) {
      return `https://api.tixly.cz/api/wallet/apple/download/${serial}.pkpass`;
    },
    async getCurrentQRPayload() {
      return "dGlja2V0SWR8dG90cFZhbHVlfHRpbWVzdGFtcHxldmVudElkfHNpZw==";
    },
  };
}

// ---------------------------------------------------------------------------
// Set required ENV vars before tests run
// ---------------------------------------------------------------------------

beforeEach(() => {
  process.env["APPLE_TEAM_ID"] = "TESTTEAMID";
  process.env["APPLE_PASS_CERT_P12_BASE64"] = Buffer.from("fakeP12").toString("base64");
  process.env["APPLE_PASS_CERT_PASSWORD"] = "password123";
  process.env["APPLE_APN_KEY_BASE64"] = Buffer.from(
    "-----BEGIN EC PRIVATE KEY-----\nfake\n-----END EC PRIVATE KEY-----"
  ).toString("base64");
  process.env["APPLE_APN_KEY_ID"] = "APNKEYID1";
  process.env["APPLE_APN_TEAM_ID"] = "TESTTEAMID";
  process.env["GOOGLE_WALLET_ISSUER_ID"] = "3388000000022795";
  process.env["GOOGLE_WALLET_SERVICE_ACCOUNT_JSON"] = Buffer.from(
    JSON.stringify({
      type: "service_account",
      project_id: "tixly",
      private_key_id: "key-id-001",
      private_key:
        "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA0Z3VS5JJcds3xHn/ygWep4PAtIE=\n-----END RSA PRIVATE KEY-----",
      client_email: "wallet@tixly.iam.gserviceaccount.com",
      client_id: "12345678",
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
    })
  ).toString("base64");
});

// ---------------------------------------------------------------------------
// 1. AppleWalletService.generatePass
// ---------------------------------------------------------------------------

describe("AppleWalletService.generatePass", () => {
  it("returns a Buffer", async () => {
    const service = new AppleWalletService(new StubAppleDB(), new StubAppleHttp());
    const result = await service.generatePass("ticket-001", makeApplePassData());
    expect(result).toBeInstanceOf(Buffer);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it("output ZIP contains pass.json", async () => {
    const service = new AppleWalletService(new StubAppleDB(), new StubAppleHttp());
    const result = await service.generatePass("ticket-001", makeApplePassData());
    const zip = await JSZip.loadAsync(result);
    expect(Object.keys(zip.files)).toContain("pass.json");
  });

  it("output ZIP contains manifest.json", async () => {
    const service = new AppleWalletService(new StubAppleDB(), new StubAppleHttp());
    const result = await service.generatePass("ticket-001", makeApplePassData());
    const zip = await JSZip.loadAsync(result);
    expect(Object.keys(zip.files)).toContain("manifest.json");
  });

  it("output ZIP contains signature", async () => {
    const service = new AppleWalletService(new StubAppleDB(), new StubAppleHttp());
    const result = await service.generatePass("ticket-001", makeApplePassData());
    const zip = await JSZip.loadAsync(result);
    expect(Object.keys(zip.files)).toContain("signature");
  });

  it("output ZIP contains all required image assets", async () => {
    const service = new AppleWalletService(new StubAppleDB(), new StubAppleHttp());
    const result = await service.generatePass("ticket-001", makeApplePassData());
    const zip = await JSZip.loadAsync(result);
    const files = Object.keys(zip.files);
    expect(files).toContain("icon.png");
    expect(files).toContain("icon@2x.png");
    expect(files).toContain("logo.png");
    expect(files).toContain("logo@2x.png");
    expect(files).toContain("strip.png");
  });

  it("pass.json contains correct serialNumber", async () => {
    const service = new AppleWalletService(new StubAppleDB(), new StubAppleHttp());
    const result = await service.generatePass("ticket-42", makeApplePassData());
    const zip = await JSZip.loadAsync(result);
    const passJsonStr = await zip.file("pass.json")!.async("string");
    const passJson = JSON.parse(passJsonStr) as { serialNumber: string };
    expect(passJson.serialNumber).toBe("ticket-ticket-42");
  });

  it("pass.json barcode.message matches qrMessage", async () => {
    const qrMessage = "custom-qr-payload-xyz";
    const service = new AppleWalletService(new StubAppleDB(), new StubAppleHttp());
    const result = await service.generatePass("ticket-001", makeApplePassData({ qrMessage }));
    const zip = await JSZip.loadAsync(result);
    const passJsonStr = await zip.file("pass.json")!.async("string");
    const passJson = JSON.parse(passJsonStr) as { barcode: { message: string } };
    expect(passJson.barcode.message).toBe(qrMessage);
  });

  it("manifest.json contains SHA-1 hashes for all assets", async () => {
    const service = new AppleWalletService(new StubAppleDB(), new StubAppleHttp());
    const result = await service.generatePass("ticket-001", makeApplePassData());
    const zip = await JSZip.loadAsync(result);
    const manifestStr = await zip.file("manifest.json")!.async("string");
    const manifest = JSON.parse(manifestStr) as Record<string, string>;
    // Each hash should be a 40-char hex SHA-1
    for (const [filename, hash] of Object.entries(manifest)) {
      expect(hash).toMatch(/^[a-f0-9]{40}$/, `${filename} has invalid SHA-1 hash`);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. GoogleWalletService.generatePassJWT
// ---------------------------------------------------------------------------

describe("GoogleWalletService.generatePassJWT", () => {
  it("returns a string", async () => {
    const http = new StubGoogleHttp();
    const service = new GoogleWalletService(http);
    const result = await service.generatePassJWT("ticket-001", makeGooglePassData());
    expect(typeof result).toBe("string");
  });

  it("JWT has exactly 3 dot-separated parts (header.payload.signature)", async () => {
    const http = new StubGoogleHttp();
    const service = new GoogleWalletService(http);
    const jwt = await service.generatePassJWT("ticket-001", makeGooglePassData());
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);
  });

  it("JWT header decodes to { alg: 'RS256', typ: 'JWT' }", async () => {
    const http = new StubGoogleHttp();
    const service = new GoogleWalletService(http);
    const jwt = await service.generatePassJWT("ticket-001", makeGooglePassData());
    const [headerB64] = jwt.split(".");
    const header = JSON.parse(
      Buffer.from(headerB64!, "base64url").toString("utf8")
    ) as { alg: string; typ: string };
    expect(header.alg).toBe("RS256");
    expect(header.typ).toBe("JWT");
  });

  it("JWT payload contains aud: 'google' and typ: 'savetowallet'", async () => {
    const http = new StubGoogleHttp();
    const service = new GoogleWalletService(http);
    const jwt = await service.generatePassJWT("ticket-001", makeGooglePassData());
    const [, payloadB64] = jwt.split(".");
    const payload = JSON.parse(
      Buffer.from(payloadB64!, "base64url").toString("utf8")
    ) as { aud: string; typ: string };
    expect(payload.aud).toBe("google");
    expect(payload.typ).toBe("savetowallet");
  });

  it("generateAddToWalletUrl builds correct URL", () => {
    const http = new StubGoogleHttp();
    const service = new GoogleWalletService(http);
    const fakeJwt = "header.payload.signature";
    const url = service.generateAddToWalletUrl(fakeJwt);
    expect(url).toBe(`https://pay.google.com/gp/v/save/${fakeJwt}`);
  });

  it("calls Google Wallet API to create EventTicketClass and Object", async () => {
    const http = new StubGoogleHttp();
    const service = new GoogleWalletService(http);
    await service.generatePassJWT("ticket-001", makeGooglePassData());
    // Should POST to token endpoint + class endpoint + object endpoint
    expect(http.postCalls.length).toBeGreaterThanOrEqual(3);
    const hasClassCall = http.postCalls.some((u) => u.includes("eventTicketClass"));
    const hasObjectCall = http.postCalls.some((u) => u.includes("eventTicketObject"));
    expect(hasClassCall).toBe(true);
    expect(hasObjectCall).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. WalletService.pushUpdateOnQRChange
// ---------------------------------------------------------------------------

describe("WalletService.pushUpdateOnQRChange", () => {
  it("calls appleService.sendPushUpdate with the ticketId", async () => {
    const appleDB = new StubAppleDB();
    const appleHttp = new StubAppleHttp();
    const googleHttp = new StubGoogleHttp();

    const appleService = new AppleWalletService(appleDB, appleHttp);
    const googleService = new GoogleWalletService(googleHttp);
    const walletDB = makeStubWalletDB();
    const walletService = new WalletService(walletDB, appleService, googleService);

    const sendPushSpy = vi.spyOn(appleService, "sendPushUpdate").mockResolvedValue();
    const updateBarcodeSpy = vi.spyOn(googleService, "updatePassBarcode").mockResolvedValue();

    await walletService.pushUpdateOnQRChange("ticket-001", "new-qr-payload");

    expect(sendPushSpy).toHaveBeenCalledOnce();
    expect(sendPushSpy).toHaveBeenCalledWith("ticket-001");
    expect(updateBarcodeSpy).toHaveBeenCalledOnce();
    expect(updateBarcodeSpy).toHaveBeenCalledWith("ticket-001", "new-qr-payload");
  });

  it("calls googleService.updatePassBarcode with new QR payload", async () => {
    const appleService = new AppleWalletService(new StubAppleDB(), new StubAppleHttp());
    const googleService = new GoogleWalletService(new StubGoogleHttp());
    const walletDB = makeStubWalletDB();
    const walletService = new WalletService(walletDB, appleService, googleService);

    vi.spyOn(appleService, "sendPushUpdate").mockResolvedValue();
    const updateSpy = vi.spyOn(googleService, "updatePassBarcode").mockResolvedValue();

    const newPayload = "brand-new-qr-payload-after-resale";
    await walletService.pushUpdateOnQRChange("ticket-001", newPayload);

    expect(updateSpy).toHaveBeenCalledWith("ticket-001", newPayload);
  });
});

// ---------------------------------------------------------------------------
// 4. WalletService.issueWalletPass
// ---------------------------------------------------------------------------

describe("WalletService.issueWalletPass", () => {
  it("Apple: returns result with platform='apple' and downloadUrl", async () => {
    const appleService = new AppleWalletService(new StubAppleDB(), new StubAppleHttp());
    const googleService = new GoogleWalletService(new StubGoogleHttp());
    const walletDB = makeStubWalletDB();
    const walletService = new WalletService(walletDB, appleService, googleService);

    // Mock generatePass so it doesn't require real P12
    vi.spyOn(appleService, "generatePass").mockResolvedValue(Buffer.from("fakepkpass"));

    const result = await walletService.issueWalletPass("ticket-001", "apple", "user-001");

    expect(result.platform).toBe("apple");
    if (result.platform === "apple") {
      expect(typeof result.downloadUrl).toBe("string");
      expect(result.downloadUrl).toContain("ticket-");
    }
  });

  it("Google: returns result with platform='google', jwt, and addToWalletUrl", async () => {
    const appleService = new AppleWalletService(new StubAppleDB(), new StubAppleHttp());
    const googleService = new GoogleWalletService(new StubGoogleHttp());
    const walletDB = makeStubWalletDB();
    const walletService = new WalletService(walletDB, appleService, googleService);

    vi.spyOn(googleService, "generatePassJWT").mockResolvedValue("h.p.s");
    vi.spyOn(googleService, "generateAddToWalletUrl").mockReturnValue(
      "https://pay.google.com/gp/v/save/h.p.s"
    );

    const result = await walletService.issueWalletPass("ticket-001", "google", "user-001");

    expect(result.platform).toBe("google");
    if (result.platform === "google") {
      expect(result.jwt).toBe("h.p.s");
      expect(result.addToWalletUrl).toBe("https://pay.google.com/gp/v/save/h.p.s");
    }
  });

  it("throws TICKET_NOT_FOUND for unknown ticket", async () => {
    const appleService = new AppleWalletService(new StubAppleDB(), new StubAppleHttp());
    const googleService = new GoogleWalletService(new StubGoogleHttp());
    const walletDB = makeStubWalletDB();
    const walletService = new WalletService(walletDB, appleService, googleService);

    await expect(
      walletService.issueWalletPass("unknown-ticket", "apple", "user-001")
    ).rejects.toThrow("WALLET_ISSUE: ticket not found");
  });

  it("throws ownership error for wrong userId", async () => {
    const appleService = new AppleWalletService(new StubAppleDB(), new StubAppleHttp());
    const googleService = new GoogleWalletService(new StubGoogleHttp());
    const walletDB = makeStubWalletDB();
    const walletService = new WalletService(walletDB, appleService, googleService);

    await expect(
      walletService.issueWalletPass("ticket-001", "apple", "wrong-user-999")
    ).rejects.toThrow("does not own ticket");
  });
});

// ---------------------------------------------------------------------------
// 5. Apple registration flow
// ---------------------------------------------------------------------------

describe("Apple registration flow", () => {
  it("register → getUpdatedSerials → unregister", async () => {
    const db = new StubAppleDB();
    const service = new AppleWalletService(db, new StubAppleHttp());

    const deviceId = "device-abc-123";
    const passType = "pass.cz.tixly.ticket";
    const serial = "ticket-test-ticket-001";
    const pushToken = "apns-push-token-xyz";
    const authToken = "validtoken123"; // matches StubAppleDB seed

    // 1. Register
    await service.handleRegistration(
      deviceId,
      passType,
      serial,
      authToken,
      pushToken
    );

    // Verify registration persisted
    const regs = await db.getRegistrations(serial);
    expect(regs).toHaveLength(1);
    expect(regs[0]!.pushToken).toBe(pushToken);

    // 2. getUpdatedSerials — since epoch 0, should return the serial
    const { serialNumbers, lastUpdated } = await service.getUpdatedPassSerials(
      deviceId,
      passType,
      new Date(0).toISOString()
    );
    expect(serialNumbers).toContain(serial);
    expect(typeof lastUpdated).toBe("string");

    // 3. Unregister
    await service.handleUnregistration(deviceId, passType, serial);
    const regsAfter = await db.getRegistrations(serial);
    expect(regsAfter).toHaveLength(0);
  });

  it("registration fails with wrong authToken", async () => {
    const db = new StubAppleDB();
    const service = new AppleWalletService(db, new StubAppleHttp());

    await expect(
      service.handleRegistration(
        "device-xyz",
        "pass.cz.tixly.ticket",
        "ticket-test-ticket-001",
        "WRONG_TOKEN",
        "push-token"
      )
    ).rejects.toThrow("invalid authToken");
  });

  it("getUpdatedSerials returns empty when no passes updated since future timestamp", async () => {
    const db = new StubAppleDB();
    const service = new AppleWalletService(db, new StubAppleHttp());

    const futureTs = new Date(Date.now() + 1_000_000_000).toISOString();
    const { serialNumbers } = await service.getUpdatedPassSerials(
      "device-xyz",
      "pass.cz.tixly.ticket",
      futureTs
    );
    expect(serialNumbers).toHaveLength(0);
  });

  it("sendPushUpdate does nothing when no registrations exist", async () => {
    const http = new StubAppleHttp();
    const service = new AppleWalletService(new StubAppleDB(), http);

    await service.sendPushUpdate("ticket-with-no-registrations");
    // No APN calls should have been made
    expect(http.calls).toHaveLength(0);
  });
});
