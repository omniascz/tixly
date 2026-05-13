import { generateTOTP, verifyTOTP } from "../lib/totp";
import {
  encodeQRPayload,
  decodeQRPayload,
  verifyQRPayload,
} from "../lib/qr-payload";
import { decryptSecret } from "./totp-encryption.service";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ErrorCode =
  | "INVALID_SIGNATURE"
  | "INVALID_TOTP"
  | "ALREADY_SCANNED"
  | "REVOKED"
  | "WRONG_EVENT"
  | "EXPIRED";

export interface ScanResult {
  success: boolean;
  ticketId: string;
  holderName: string;
  seatInfo: string;
  errorCode?: ErrorCode;
}

// ---------------------------------------------------------------------------
// External dependency interfaces (to be injected — avoids hard coupling)
// ---------------------------------------------------------------------------

export interface TicketRecord {
  ticketId: string;
  userId: string;
  eventId: string;
  holderName: string;
  seatInfo: string;
  status: "valid" | "revoked" | "used" | "transferred" | "resale_listed";
  totpSecretEncrypted: Buffer;
  totpSecretIv: Buffer;
}

export interface DBAdapter {
  getTicket(ticketId: string): Promise<TicketRecord | null>;
  insertScanLog(
    ticketId: string,
    scannerDeviceId: string,
    scannedAt: Date
  ): Promise<void>;
}

export interface RedisAdapter {
  /** Returns true if the key did NOT exist before (i.e. not yet seen). */
  setNX(key: string, value: string, ttlSeconds: number): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class TicketQRService {
  constructor(
    private readonly db: DBAdapter,
    private readonly redis: RedisAdapter
  ) {}

  /**
   * Generates a fresh QR payload for a ticket.
   * Verifies that the requesting user owns the ticket before decrypting the secret.
   */
  async generateQR(ticketId: string, userId: string): Promise<string> {
    const ticket = await this.db.getTicket(ticketId);
    if (!ticket) {
      throw new Error(`TICKET_NOT_FOUND: ${ticketId}`);
    }
    if (ticket.userId !== userId) {
      throw new Error(`TICKET_OWNERSHIP_DENIED: ${ticketId}`);
    }
    if (ticket.status === "revoked") {
      throw new Error(`TICKET_REVOKED: ${ticketId}`);
    }

    const secret = await decryptSecret(
      ticket.totpSecretEncrypted,
      ticket.totpSecretIv,
      ticketId
    );

    const totpValue = generateTOTP(secret);
    return encodeQRPayload(ticketId, totpValue, ticket.eventId, secret);
  }

  /**
   * Refreshes the QR payload. Called every 30 seconds by the frontend.
   * Ownership is assumed already verified (protected by session middleware).
   */
  async refreshQR(ticketId: string, userId: string): Promise<string> {
    return this.generateQR(ticketId, userId);
  }

  /**
   * Validates a scanned QR code.
   *
   * Steps:
   * 1. Decode and verify HMAC signature.
   * 2. Verify eventId matches.
   * 3. Load ticket from DB, check status.
   * 4. Decrypt TOTP secret, verify TOTP value.
   * 5. Anti-replay check via Redis SETNX.
   * 6. Write scan log.
   */
  async validateQR(
    encoded: string,
    eventId: string,
    scannerDeviceId: string
  ): Promise<ScanResult> {
    // --- Decode ---
    let payload;
    try {
      payload = decodeQRPayload(encoded);
    } catch {
      return this.failure("", "INVALID_SIGNATURE");
    }

    // --- Event check ---
    if (payload.eventId !== eventId) {
      return this.failure(payload.ticketId, "WRONG_EVENT");
    }

    // --- Expiry check (QR valid for 90s = 3 time-steps) ---
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - payload.timestamp) > 90) {
      return this.failure(payload.ticketId, "EXPIRED");
    }

    // --- Load ticket ---
    const ticket = await this.db.getTicket(payload.ticketId);
    if (!ticket) {
      return this.failure(payload.ticketId, "INVALID_SIGNATURE");
    }
    if (ticket.status === "revoked") {
      return this.failure(payload.ticketId, "REVOKED");
    }

    // --- Decrypt secret ---
    let secret: Buffer;
    try {
      secret = await decryptSecret(
        ticket.totpSecretEncrypted,
        ticket.totpSecretIv,
        payload.ticketId
      );
    } catch {
      return this.failure(payload.ticketId, "INVALID_SIGNATURE");
    }

    // --- Verify HMAC signature ---
    if (!verifyQRPayload(payload, secret)) {
      return this.failure(payload.ticketId, "INVALID_SIGNATURE");
    }

    // --- Verify TOTP (uses payload.timestamp for clock-skew window) ---
    const totpTimestampMs = payload.timestamp * 1000;
    if (!verifyTOTP(secret, payload.totpValue, totpTimestampMs)) {
      return this.failure(payload.ticketId, "INVALID_TOTP");
    }

    // --- Anti-replay: Redis SETNX with 90s TTL ---
    const replayKey = `tixly:totp:used:${payload.ticketId}:${payload.totpValue}`;
    const isNew = await this.redis.setNX(replayKey, "1", 90);
    if (!isNew) {
      return this.failure(payload.ticketId, "ALREADY_SCANNED");
    }

    // --- Record scan ---
    await this.db.insertScanLog(
      payload.ticketId,
      scannerDeviceId,
      new Date()
    );

    return {
      success: true,
      ticketId: ticket.ticketId,
      holderName: ticket.holderName,
      seatInfo: ticket.seatInfo,
    };
  }

  private failure(ticketId: string, errorCode: ErrorCode): ScanResult {
    return {
      success: false,
      ticketId,
      holderName: "",
      seatInfo: "",
      errorCode,
    };
  }
}
