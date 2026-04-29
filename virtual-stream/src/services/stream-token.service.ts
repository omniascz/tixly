// =============================================================================
// StreamTokenService
// Vydává krátkodobé podepsané tokeny pro přístup ke streamu.
//
// Token formát: <base64url(header)>.<base64url(payload)>.<base64url(sig)>
// Podpis: HMAC-SHA256(header + "." + payload, STREAM_TOKEN_SECRET)
//
// Proč ne JWT knihovna: chceme minimální závislosti a plnou kontrolu nad
// payloadem. Formát je kompatibilní s Mux/Cloudflare Stream signed URL.
// =============================================================================

import { createHmac, randomBytes, createHash, timingSafeEqual } from "crypto";
import { isGeoAllowed, type GeoBlockConfig, type GeoProvider } from "../lib/geo-block";

// ---------------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------------

export type AttendanceType = "physical" | "online" | "hybrid";
export type AccessType = "live" | "replay";

export interface EventStreamConfig {
  eventId: string;
  streamProvider: string | null;
  streamUrlEncrypted: Buffer | null;
  streamUrlIv: Buffer | null;
  streamStartsAt: Date | null;
  streamEndsAt: Date | null;
  replayEnabled: boolean;
  replayWindowHours: number | null;
  maxConcurrentViewers: number | null;
  geoBlockMode: GeoBlockConfig["mode"];
  geoBlockCountries: string[];
}

export interface TicketStreamRecord {
  ticketId: string;
  userId: string;
  eventId: string;
  attendanceType: AttendanceType;
  ticketStatus: string; // 'valid' | 'used' | 'refunded' | ...
  streamAccessCount: number;
}

export interface StreamTokenPayload {
  jti: string;        // unique token ID
  tid: string;        // ticketId
  uid: string;        // userId
  eid: string;        // eventId
  type: AccessType;
  iat: number;        // issued at (unix seconds)
  exp: number;        // expires at (unix seconds)
}

export interface StreamTokenResult {
  token: string;
  payload: StreamTokenPayload;
  /** Dešifrovaná stream URL pro přehrávač (nikdy ji nelogovat). */
  streamUrl: string;
  expiresAt: Date;
  accessType: AccessType;
}

// ---------------------------------------------------------------------------
// DB adapter interface
// ---------------------------------------------------------------------------

export interface StreamDBAdapter {
  getTicketWithEvent(ticketId: string): Promise<{
    ticket: TicketStreamRecord;
    event: EventStreamConfig;
  } | null>;

  incrementStreamAccess(ticketId: string, tokenHash: string): Promise<void>;

  logStreamTokenIssued(entry: {
    ticketId: string;
    eventId: string;
    userId: string;
    tokenJti: string;
    tokenIssuedAt: Date;
    tokenExpiresAt: Date;
    accessType: AccessType;
    ipHash: string | null;
    countryCode: string | null;
    geoBlocked: boolean;
    issued: boolean;
    denyReason: string | null;
  }): Promise<void>;

  /** Počet aktivních (neexpirovaných) live tokenů pro daný event. */
  countActiveLiveViewers(eventId: string): Promise<number>;

  /** Dešifruje stream URL ze store (AES-256-GCM). */
  decryptStreamUrl(encrypted: Buffer, iv: Buffer): Promise<string>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** Živý stream: token platí po dobu streamu + buffer, max 4 hodiny. */
const LIVE_TOKEN_TTL_SECONDS = 4 * 60 * 60;
/** Replay: token platí 24 hodin (uživatel může spustit přehrávač kdykoli). */
const REPLAY_TOKEN_TTL_SECONDS = 24 * 60 * 60;
/** Kolik sekund před stream_starts_at je token dostupný (buffer pro načtení). */
const STREAM_PRE_OPEN_SECONDS = 15 * 60; // 15 minut předem

export class StreamTokenService {
  constructor(
    private readonly db: StreamDBAdapter,
    private readonly geoProvider: GeoProvider,
    private readonly secret: string // STREAM_TOKEN_SECRET env var
  ) {
    if (!secret || secret.length < 32) {
      throw new Error("STREAM_TOKEN_SECRET musí mít alespoň 32 znaků");
    }
  }

  // -------------------------------------------------------------------------
  // Vydání tokenu
  // -------------------------------------------------------------------------

  async issueToken(
    ticketId: string,
    requestingUserId: string,
    clientIp: string | null
  ): Promise<StreamTokenResult> {
    const now = new Date();
    const nowSec = Math.floor(now.getTime() / 1000);

    // 1. Načíst ticket + event
    const record = await this.db.getTicketWithEvent(ticketId);
    if (!record) {
      throw new StreamTokenError("TICKET_NOT_FOUND", 404);
    }

    const { ticket, event } = record;

    // 2. Ownership check
    if (ticket.userId !== requestingUserId) {
      throw new StreamTokenError("FORBIDDEN", 403);
    }

    // 3. Ticket musí být platný a mít stream přístup
    if (!["valid", "used"].includes(ticket.ticketStatus)) {
      throw new StreamTokenError("TICKET_INVALID", 403, "ticket_invalid");
    }
    if (!["online", "hybrid"].includes(ticket.attendanceType)) {
      throw new StreamTokenError("NO_STREAM_ACCESS", 403, "no_stream_access");
    }
    if (!event.streamProvider || !event.streamUrlEncrypted || !event.streamUrlIv) {
      throw new StreamTokenError("NO_STREAM_ACCESS", 403, "no_stream_access");
    }

    // 4. Určit typ přístupu (live nebo replay)
    const accessType = this.resolveAccessType(event, now);
    if (!accessType) {
      throw new StreamTokenError("EVENT_NOT_LIVE", 403, "event_not_live");
    }

    // 5. Geo-block
    const geoConfig: GeoBlockConfig = {
      mode: event.geoBlockMode,
      countries: event.geoBlockCountries,
    };
    const countryCode = clientIp ? await this.geoProvider.lookup(clientIp) : null;
    const ipHash = clientIp
      ? createHash("sha256").update(clientIp).digest("hex")
      : null;

    if (!isGeoAllowed(countryCode, geoConfig)) {
      await this.db.logStreamTokenIssued({
        ticketId,
        eventId: event.eventId,
        userId: requestingUserId,
        tokenJti: randomBytes(16).toString("hex"),
        tokenIssuedAt: now,
        tokenExpiresAt: now,
        accessType,
        ipHash,
        countryCode,
        geoBlocked: true,
        issued: false,
        denyReason: "geo_blocked",
      });
      throw new StreamTokenError("GEO_BLOCKED", 403, "geo_blocked");
    }

    // 6. Concurrent viewer limit
    if (accessType === "live" && event.maxConcurrentViewers !== null) {
      const active = await this.db.countActiveLiveViewers(event.eventId);
      if (active >= event.maxConcurrentViewers) {
        await this.db.logStreamTokenIssued({
          ticketId,
          eventId: event.eventId,
          userId: requestingUserId,
          tokenJti: randomBytes(16).toString("hex"),
          tokenIssuedAt: now,
          tokenExpiresAt: now,
          accessType,
          ipHash,
          countryCode,
          geoBlocked: false,
          issued: false,
          denyReason: "concurrent_limit",
        });
        throw new StreamTokenError("CONCURRENT_LIMIT", 429, "concurrent_limit");
      }
    }

    // 7. Sestavit token payload
    const ttl = accessType === "live" ? LIVE_TOKEN_TTL_SECONDS : REPLAY_TOKEN_TTL_SECONDS;
    const exp = nowSec + ttl;
    const jti = randomBytes(16).toString("hex");

    const tokenPayload: StreamTokenPayload = {
      jti,
      tid: ticketId,
      uid: requestingUserId,
      eid: event.eventId,
      type: accessType,
      iat: nowSec,
      exp,
    };

    const token = this.signToken(tokenPayload);
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(exp * 1000);

    // 8. Dešifrovat stream URL
    const streamUrl = await this.db.decryptStreamUrl(
      event.streamUrlEncrypted!,
      event.streamUrlIv!
    );

    // 9. Uložit do DB
    await Promise.all([
      this.db.incrementStreamAccess(ticketId, tokenHash),
      this.db.logStreamTokenIssued({
        ticketId,
        eventId: event.eventId,
        userId: requestingUserId,
        tokenJti: jti,
        tokenIssuedAt: now,
        tokenExpiresAt: expiresAt,
        accessType,
        ipHash,
        countryCode,
        geoBlocked: false,
        issued: true,
        denyReason: null,
      }),
    ]);

    return { token, payload: tokenPayload, streamUrl, expiresAt, accessType };
  }

  // -------------------------------------------------------------------------
  // Ověření tokenu (pro CDN webhook nebo server-side player auth)
  // -------------------------------------------------------------------------

  verifyToken(rawToken: string): StreamTokenPayload {
    const parts = rawToken.split(".");
    if (parts.length !== 3) {
      throw new StreamTokenError("INVALID_TOKEN", 401);
    }

    const [headerB64, payloadB64, sigB64] = parts;
    const expectedSig = this.computeSignature(`${headerB64}.${payloadB64}`);
    const actualSig = Buffer.from(sigB64, "base64url");

    if (!timingSafeEqual(Buffer.from(expectedSig, "base64url"), actualSig)) {
      throw new StreamTokenError("INVALID_SIGNATURE", 401);
    }

    let payload: StreamTokenPayload;
    try {
      payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    } catch {
      throw new StreamTokenError("INVALID_TOKEN", 401);
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp < nowSec) {
      throw new StreamTokenError("TOKEN_EXPIRED", 401);
    }

    return payload;
  }

  // -------------------------------------------------------------------------
  // Interní helpers
  // -------------------------------------------------------------------------

  private resolveAccessType(
    event: EventStreamConfig,
    now: Date
  ): AccessType | null {
    const nowMs = now.getTime();

    const startsAt = event.streamStartsAt?.getTime() ?? null;
    const endsAt = event.streamEndsAt?.getTime() ?? null;

    // Živý stream: v okně [starts_at - buffer, ends_at]
    const preOpen = STREAM_PRE_OPEN_SECONDS * 1000;
    if (
      startsAt !== null &&
      endsAt !== null &&
      nowMs >= startsAt - preOpen &&
      nowMs <= endsAt
    ) {
      return "live";
    }

    // Replay: po skončení streamu, v rámci replay window
    if (event.replayEnabled && endsAt !== null && nowMs > endsAt) {
      if (event.replayWindowHours === null) return "replay"; // neomezeno
      if (event.replayWindowHours === 0) return null;       // bez replay
      const replayUntil = endsAt + event.replayWindowHours * 3600 * 1000;
      if (nowMs <= replayUntil) return "replay";
    }

    return null;
  }

  private signToken(payload: StreamTokenPayload): string {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "ST" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = this.computeSignature(`${header}.${body}`);
    return `${header}.${body}.${sig}`;
  }

  private computeSignature(data: string): string {
    return createHmac("sha256", this.secret).update(data).digest("base64url");
  }
}

// ---------------------------------------------------------------------------
// Custom error
// ---------------------------------------------------------------------------

export class StreamTokenError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
    public readonly denyReason?: string
  ) {
    super(code);
    this.name = "StreamTokenError";
  }
}
