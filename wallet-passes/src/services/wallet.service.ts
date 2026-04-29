/**
 * Wallet orchestrator service.
 *
 * Single entry point for the rest of the application. Delegates to:
 *  - AppleWalletService  — PKPass generation + APN push
 *  - GoogleWalletService — Google Wallet JWT + barcode PATCH
 *
 * All DB and HTTP dependencies are injected so this class is testable
 * without a real database or external HTTP calls.
 */

import { AppleWalletService } from "./apple-wallet.service.js";
import { GoogleWalletService } from "./google-wallet.service.js";
import type {
  WalletPlatform,
  WalletPass,
  ApplePassData,
  GooglePassData,
} from "../types/wallet.js";

// ---------------------------------------------------------------------------
// External dependency interfaces
// ---------------------------------------------------------------------------

/**
 * Minimal ticket record shape needed by the wallet orchestrator.
 * The full ticket record lives in the tickets service; we only project
 * the fields we actually need here.
 */
export interface TicketForWallet {
  ticketId: string;
  eventId: string;
  userId: string;
  holderName: string;
  seatInfo: string;
  seatNumber?: string | undefined;
  row?: string | undefined;
  section?: string | undefined;
  ticketType: string;
  /** AES-encrypted TOTP secret (stored in DB) */
  totpSecretEncrypted: Buffer;
  /** IV for the above */
  totpSecretIv: Buffer;
}

export interface EventForWallet {
  eventId: string;
  title: string;
  venueName: string;
  /** ISO date: "2026-06-15" */
  eventDate: string;
  /** HH:mm: "19:30" */
  eventTime: string;
}

export interface WalletDBAdapter {
  getTicket(ticketId: string): Promise<TicketForWallet | null>;
  getEvent(eventId: string): Promise<EventForWallet | null>;
  getPass(ticketId: string, platform: WalletPlatform): Promise<WalletPass | null>;
  upsertPass(pass: Omit<WalletPass, "id"> & { id?: string }): Promise<WalletPass>;
  updatePassTimestamp(ticketId: string, platform: WalletPlatform): Promise<void>;
  generateDownloadUrl(serialNumber: string): Promise<string>;
  /** Decrypts the TOTP secret and generates the current QR payload string */
  getCurrentQRPayload(ticket: TicketForWallet): Promise<string>;
}

// ---------------------------------------------------------------------------
// Issuing result types
// ---------------------------------------------------------------------------

export interface AppleIssueResult {
  platform: "apple";
  downloadUrl: string;
}

export interface GoogleIssueResult {
  platform: "google";
  jwt: string;
  addToWalletUrl: string;
}

export type IssueWalletPassResult = AppleIssueResult | GoogleIssueResult;

// ---------------------------------------------------------------------------
// WalletService
// ---------------------------------------------------------------------------

export class WalletService {
  constructor(
    private readonly db: WalletDBAdapter,
    private readonly appleService: AppleWalletService,
    private readonly googleService: GoogleWalletService
  ) {}

  // -------------------------------------------------------------------------
  // issueWalletPass
  // -------------------------------------------------------------------------

  /**
   * Issues a wallet pass for the given ticket and platform.
   *
   * Flow:
   *  1. Load ticket + event from DB; verify user owns the ticket.
   *  2. Generate the current QR payload (TOTP at current timestamp).
   *  3. Delegate to Apple or Google service to generate pass bytes / JWT.
   *  4. Persist the WalletPass record (upsert — re-issuance is safe).
   *  5. Return the result appropriate for the platform.
   *
   * Re-issuance: calling this again for the same ticketId + platform updates
   * the pass record (new QR payload). Apple devices will receive a push and
   * re-download; Google devices get the new JWT link.
   */
  async issueWalletPass(
    ticketId: string,
    platform: WalletPlatform,
    userId: string
  ): Promise<IssueWalletPassResult> {
    const ticket = await this.db.getTicket(ticketId);
    if (!ticket) {
      throw new Error(`WALLET_ISSUE: ticket not found: ${ticketId}`);
    }
    if (ticket.userId !== userId) {
      throw new Error(`WALLET_ISSUE: user ${userId} does not own ticket ${ticketId}`);
    }

    const event = await this.db.getEvent(ticket.eventId);
    if (!event) {
      throw new Error(`WALLET_ISSUE: event not found: ${ticket.eventId}`);
    }

    // Generate the current QR payload using the ticket's TOTP secret
    const currentQRPayload = await this.db.getCurrentQRPayload(ticket);

    if (platform === "apple") {
      return this.issueApplePass(ticketId, ticket, event, currentQRPayload);
    } else {
      return this.issueGooglePass(ticketId, ticket, event, currentQRPayload);
    }
  }

  // -------------------------------------------------------------------------
  // pushUpdateOnQRChange
  // -------------------------------------------------------------------------

  /**
   * Called when a TOTP secret changes — either after a resale transfer
   * (new totp_secret generated) or a manual QR refresh.
   *
   * Fan-out:
   *  - Apple: sends APN push so each registered device re-fetches the pass.
   *  - Google: PATCHes the barcode.value on the existing EventTicketObject.
   *  - Both: bumps wallet_passes.updated_at so Apple's polling endpoint
   *    includes this serial in its response.
   *
   * Both platform updates are attempted in parallel; errors are surfaced
   * individually so a failure on one platform doesn't suppress the other.
   */
  async pushUpdateOnQRChange(
    ticketId: string,
    newQRPayload: string
  ): Promise<void> {
    const results = await Promise.allSettled([
      this.appleService.sendPushUpdate(ticketId),
      this.googleService.updatePassBarcode(ticketId, newQRPayload),
      this.db.updatePassTimestamp(ticketId, "apple"),
      this.db.updatePassTimestamp(ticketId, "google"),
    ]);

    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => String(r.reason));

    if (errors.length > 0) {
      // Surface aggregated error but don't swallow individual messages
      throw new Error(
        `WALLET_PUSH_UPDATE: ${errors.length} platform(s) failed:\n${errors.join("\n")}`
      );
    }
  }

  // -------------------------------------------------------------------------
  // pushTotpRotationUpdate
  // -------------------------------------------------------------------------

  /**
   * Push an update to all wallet passes registered for a ticket. Called when
   * the ticket's TOTP secret is rotated — subscribers (iOS Wallet app, Google
   * Wallet) will re-fetch the pass and show the new barcode.
   *
   * Fire-and-forget semantics: errors on one platform do not block the other.
   * Returns per-platform outcome so callers can log/metric the result.
   */
  async pushTotpRotationUpdate(ticketId: string): Promise<{
    apple: { attempted: boolean; ok: boolean; reason?: string };
    google: { attempted: boolean; ok: boolean; reason?: string };
  }> {
    const ticket = await this.db.getTicket(ticketId);
    if (!ticket) {
      return {
        apple: { attempted: false, ok: false, reason: "ticket_not_found" },
        google: { attempted: false, ok: false, reason: "ticket_not_found" },
      };
    }

    const [applePass, googlePass] = await Promise.all([
      this.db.getPass(ticketId, "apple"),
      this.db.getPass(ticketId, "google"),
    ]);

    const apple: { attempted: boolean; ok: boolean; reason?: string } = applePass
      ? { attempted: true, ok: false }
      : { attempted: false, ok: false, reason: "no_apple_pass" };
    const google: { attempted: boolean; ok: boolean; reason?: string } = googlePass
      ? { attempted: true, ok: false }
      : { attempted: false, ok: false, reason: "no_google_pass" };

    // Fresh QR payload (current TOTP) — needed for Google PATCH.
    let newQRPayload = "";
    if (googlePass) {
      try {
        newQRPayload = await this.db.getCurrentQRPayload(ticket);
      } catch (err) {
        google.reason = err instanceof Error ? err.message : String(err);
      }
    }

    const tasks: Promise<void>[] = [];

    if (applePass) {
      tasks.push(
        (async () => {
          try {
            // Existing APN push method on AppleWalletService.
            await this.appleService.sendPushUpdate(ticketId);
            await this.db.updatePassTimestamp(ticketId, "apple");
            apple.ok = true;
          } catch (err) {
            apple.ok = false;
            apple.reason = err instanceof Error ? err.message : String(err);
          }
        })()
      );
    }

    if (googlePass && !google.reason) {
      tasks.push(
        (async () => {
          try {
            // Existing PATCH method on GoogleWalletService.
            await this.googleService.updatePassBarcode(ticketId, newQRPayload);
            await this.db.updatePassTimestamp(ticketId, "google");
            google.ok = true;
          } catch (err) {
            google.ok = false;
            google.reason = err instanceof Error ? err.message : String(err);
          }
        })()
      );
    }

    await Promise.all(tasks);

    return { apple, google };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async issueApplePass(
    ticketId: string,
    ticket: TicketForWallet,
    event: EventForWallet,
    qrPayload: string
  ): Promise<AppleIssueResult> {
    const passData: ApplePassData = {
      eventTitle: event.title,
      venueName: event.venueName,
      eventDate: event.eventDate,
      eventTime: event.eventTime,
      holderName: ticket.holderName,
      seatInfo: ticket.seatInfo,
      ticketType: ticket.ticketType,
      qrMessage: qrPayload,
    };

    // generatePass returns the signed .pkpass ZIP buffer — we don't store it
    // here; it's generated fresh on each download request via the API route.
    await this.appleService.generatePass(ticketId, passData);

    const serialNumber = `ticket-${ticketId}`;
    const downloadUrl = await this.db.generateDownloadUrl(serialNumber);

    await this.db.upsertPass({
      ticketId,
      platform: "apple",
      passTypeIdentifier: "pass.cz.tixly.ticket",
      serialNumber,
      authenticationToken: "", // stored separately by generatePass; not re-derived here
      webServiceUrl: "https://api.tixly.cz/api/wallet/apple",
      passUrl: downloadUrl,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return { platform: "apple", downloadUrl };
  }

  private async issueGooglePass(
    ticketId: string,
    ticket: TicketForWallet,
    event: EventForWallet,
    qrPayload: string
  ): Promise<GoogleIssueResult> {
    const passData: GooglePassData = {
      eventTitle: event.title,
      venueName: event.venueName,
      eventDate: event.eventDate,
      eventTime: event.eventTime,
      holderName: ticket.holderName,
      seatInfo: ticket.seatInfo,
      seatNumber: ticket.seatNumber,
      row: ticket.row,
      section: ticket.section,
      ticketType: ticket.ticketType,
      qrMessage: qrPayload,
      eventId: ticket.eventId,
    };

    const jwt = await this.googleService.generatePassJWT(ticketId, passData);
    const addToWalletUrl = this.googleService.generateAddToWalletUrl(jwt);

    const issuerId = process.env["GOOGLE_WALLET_ISSUER_ID"] ?? "";
    await this.db.upsertPass({
      ticketId,
      platform: "google",
      passTypeIdentifier: "",
      serialNumber: `${issuerId}.${ticketId}`,
      authenticationToken: "",
      webServiceUrl: "",
      googlePassId: `${issuerId}.${ticketId}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return { platform: "google", jwt, addToWalletUrl };
  }
}
