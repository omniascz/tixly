/**
 * Vitest tests for TOTP rotation → wallet push-update fan-out.
 *
 * Covers:
 *  - WalletService.pushTotpRotationUpdate (all branches)
 *  - handleTotpRotatedEvent consumer wrapper
 *
 * Uses partial mocks of AppleWalletService / GoogleWalletService — we only
 * stub the methods actually called by pushTotpRotationUpdate.
 */

import { describe, it, expect, vi } from "vitest";

import { WalletService } from "./wallet.service.js";
import type {
  WalletDBAdapter,
  TicketForWallet,
  EventForWallet,
} from "./wallet.service.js";
import type { AppleWalletService } from "./apple-wallet.service.js";
import type { GoogleWalletService } from "./google-wallet.service.js";
import type { WalletPass, WalletPlatform } from "../types/wallet.js";

import { handleTotpRotatedEvent } from "./totp-rotation-consumer.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TICKET: TicketForWallet = {
  ticketId: "ticket-001",
  eventId: "event-001",
  userId: "user-001",
  holderName: "Jana Nováková",
  seatInfo: "Sekce A, řada 3, sedadlo 12",
  ticketType: "Standard",
  totpSecretEncrypted: Buffer.alloc(32),
  totpSecretIv: Buffer.alloc(16),
};

const EVENT: EventForWallet = {
  eventId: "event-001",
  title: "Test",
  venueName: "Venue",
  eventDate: "2026-06-15",
  eventTime: "19:30",
};

function makeApplePass(): WalletPass {
  return {
    id: "pass-apple-1",
    ticketId: "ticket-001",
    platform: "apple",
    passTypeIdentifier: "pass.cz.tixly.ticket",
    serialNumber: "ticket-ticket-001",
    authenticationToken: "tok",
    webServiceUrl: "https://api.tixly.cz/api/wallet/apple",
    passUrl: "https://example.test/apple.pkpass",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as WalletPass;
}

function makeGooglePass(): WalletPass {
  return {
    id: "pass-google-1",
    ticketId: "ticket-001",
    platform: "google",
    passTypeIdentifier: "",
    serialNumber: "issuer.ticket-001",
    authenticationToken: "",
    webServiceUrl: "",
    googlePassId: "issuer.ticket-001",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as WalletPass;
}

function makeDB(opts: {
  ticket?: TicketForWallet | null;
  applePass?: WalletPass | null;
  googlePass?: WalletPass | null;
}): WalletDBAdapter {
  const { ticket = TICKET, applePass = null, googlePass = null } = opts;
  return {
    async getTicket() { return ticket; },
    async getEvent() { return EVENT; },
    async getPass(_id: string, platform: WalletPlatform) {
      if (platform === "apple") return applePass;
      if (platform === "google") return googlePass;
      return null;
    },
    async upsertPass(pass) {
      return { id: "p", ...pass, createdAt: pass.createdAt, updatedAt: pass.updatedAt };
    },
    async updatePassTimestamp() { /* no-op */ },
    async generateDownloadUrl(s) { return `https://x/${s}`; },
    async getCurrentQRPayload() { return "new-qr-payload"; },
  };
}

function makeAppleMock(override?: Partial<{ sendPushUpdate: () => Promise<void> }>) {
  return {
    sendPushUpdate: vi.fn(override?.sendPushUpdate ?? (async () => {})),
  } as unknown as AppleWalletService & { sendPushUpdate: ReturnType<typeof vi.fn> };
}

function makeGoogleMock(override?: Partial<{ updatePassBarcode: () => Promise<void> }>) {
  return {
    updatePassBarcode: vi.fn(override?.updatePassBarcode ?? (async () => {})),
  } as unknown as GoogleWalletService & { updatePassBarcode: ReturnType<typeof vi.fn> };
}

// ---------------------------------------------------------------------------
// WalletService.pushTotpRotationUpdate
// ---------------------------------------------------------------------------

describe("WalletService.pushTotpRotationUpdate", () => {
  it("ticket not found → both platforms attempted:false", async () => {
    const db = makeDB({ ticket: null });
    const apple = makeAppleMock();
    const google = makeGoogleMock();
    const svc = new WalletService(db, apple, google);

    const result = await svc.pushTotpRotationUpdate("missing");

    expect(result.apple.attempted).toBe(false);
    expect(result.google.attempted).toBe(false);
    expect(result.apple.reason).toBe("ticket_not_found");
    expect(result.google.reason).toBe("ticket_not_found");
    expect(apple.sendPushUpdate).not.toHaveBeenCalled();
    expect(google.updatePassBarcode).not.toHaveBeenCalled();
  });

  it("only Apple pass exists → Apple push called, Google not attempted", async () => {
    const db = makeDB({ applePass: makeApplePass(), googlePass: null });
    const apple = makeAppleMock();
    const google = makeGoogleMock();
    const svc = new WalletService(db, apple, google);

    const result = await svc.pushTotpRotationUpdate("ticket-001");

    expect(result.apple).toEqual({ attempted: true, ok: true });
    expect(result.google.attempted).toBe(false);
    expect(apple.sendPushUpdate).toHaveBeenCalledWith("ticket-001");
    expect(google.updatePassBarcode).not.toHaveBeenCalled();
  });

  it("only Google pass exists → Google patch called, Apple not attempted", async () => {
    const db = makeDB({ applePass: null, googlePass: makeGooglePass() });
    const apple = makeAppleMock();
    const google = makeGoogleMock();
    const svc = new WalletService(db, apple, google);

    const result = await svc.pushTotpRotationUpdate("ticket-001");

    expect(result.apple.attempted).toBe(false);
    expect(result.google).toEqual({ attempted: true, ok: true });
    expect(apple.sendPushUpdate).not.toHaveBeenCalled();
    expect(google.updatePassBarcode).toHaveBeenCalledWith("ticket-001", "new-qr-payload");
  });

  it("both passes exist → both called", async () => {
    const db = makeDB({ applePass: makeApplePass(), googlePass: makeGooglePass() });
    const apple = makeAppleMock();
    const google = makeGoogleMock();
    const svc = new WalletService(db, apple, google);

    const result = await svc.pushTotpRotationUpdate("ticket-001");

    expect(result.apple.ok).toBe(true);
    expect(result.google.ok).toBe(true);
    expect(apple.sendPushUpdate).toHaveBeenCalledOnce();
    expect(google.updatePassBarcode).toHaveBeenCalledOnce();
  });

  it("Apple push throws → Apple ok:false with reason, Google still succeeds", async () => {
    const db = makeDB({ applePass: makeApplePass(), googlePass: makeGooglePass() });
    const apple = makeAppleMock({
      sendPushUpdate: async () => { throw new Error("apn boom"); },
    });
    const google = makeGoogleMock();
    const svc = new WalletService(db, apple, google);

    const result = await svc.pushTotpRotationUpdate("ticket-001");

    expect(result.apple.attempted).toBe(true);
    expect(result.apple.ok).toBe(false);
    expect(result.apple.reason).toContain("apn boom");
    expect(result.google.ok).toBe(true);
    expect(google.updatePassBarcode).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// handleTotpRotatedEvent consumer wrapper
// ---------------------------------------------------------------------------

describe("handleTotpRotatedEvent", () => {
  it("delegates to walletService.pushTotpRotationUpdate and returns simplified shape", async () => {
    const walletService = {
      pushTotpRotationUpdate: vi.fn(async () => ({
        apple: { attempted: true, ok: true },
        google: { attempted: false, ok: false, reason: "no_google_pass" },
      })),
    } as unknown as WalletService;

    const result = await handleTotpRotatedEvent(
      { ticketId: "ticket-001", rotatedAt: "2026-04-08T10:00:00Z" },
      walletService,
    );

    expect(
      (walletService.pushTotpRotationUpdate as unknown as ReturnType<typeof vi.fn>)
    ).toHaveBeenCalledWith("ticket-001");
    expect(result).toEqual({ apple: { ok: true }, google: { ok: false } });
  });
});
