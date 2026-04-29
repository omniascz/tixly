/**
 * Wallet pass types for Apple Wallet (PKPass) and Google Wallet.
 * Used across wallet-passes services, API routes, and DB layer.
 */

// ---------------------------------------------------------------------------
// Platform discriminator
// ---------------------------------------------------------------------------

export type WalletPlatform = "apple" | "google";

// ---------------------------------------------------------------------------
// Persisted wallet pass record (maps 1:1 to wallet_passes DB table)
// ---------------------------------------------------------------------------

export interface WalletPass {
  /** UUID primary key */
  id: string;
  /** FK → tickets.tickets(id) */
  ticketId: string;
  platform: WalletPlatform;
  /**
   * Apple: "pass.cz.tixly.ticket"
   * Google: unused — set to empty string
   */
  passTypeIdentifier: string;
  /**
   * Apple: "ticket-{ticketId}"
   * Google: "{issuerId}.{ticketId}"
   */
  serialNumber: string;
  /**
   * Apple: random 16+ char hex token verified on every request
   * Google: empty string (auth is done via service account JWT)
   */
  authenticationToken: string;
  /** Apple Wallet Web Service base URL */
  webServiceUrl: string;
  /** Signed download URL for .pkpass file (Apple only) */
  passUrl?: string | undefined;
  /** Google Wallet EventTicketObject id: "{issuerId}.{ticketId}" */
  googlePassId?: string | undefined;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Pass data shapes — used to build pass content
// ---------------------------------------------------------------------------

/**
 * Data used when building an Apple PKPass eventTicket.
 * qrMessage is the currently-valid QR payload (changes every 30s via TOTP).
 */
export interface ApplePassData {
  eventTitle: string;
  venueName: string;
  /** ISO date string, e.g. "2026-06-15" */
  eventDate: string;
  /** HH:mm, e.g. "19:30" */
  eventTime: string;
  holderName: string;
  /** Human-readable seat descriptor, e.g. "Sekce A, řada 3, sedadlo 12" */
  seatInfo: string;
  ticketType: string;
  /** Base64-encoded QR payload from encodeQRPayload() */
  qrMessage: string;
}

/**
 * Data used when building a Google Wallet EventTicketObject.
 * Mirrors ApplePassData so the orchestrator can feed the same source data
 * to both platforms without field-mapping gymnastics.
 */
export interface GooglePassData {
  eventTitle: string;
  venueName: string;
  eventDate: string;
  eventTime: string;
  holderName: string;
  seatInfo: string;
  ticketType: string;
  /** Base64-encoded QR payload from encodeQRPayload() */
  qrMessage: string;
  /** UUID of the event — used to key the shared EventTicketClass */
  eventId: string;
  /** Seat number within the row, if applicable */
  seatNumber?: string | undefined;
  /** Row identifier */
  row?: string | undefined;
  /** Section / zone identifier */
  section?: string | undefined;
}

// ---------------------------------------------------------------------------
// Push update payload
// ---------------------------------------------------------------------------

/**
 * Emitted by the resale / QR-refresh pipeline when a TOTP secret changes.
 * The WalletService receives this and fans out updates to both platforms.
 */
export interface PassUpdatePayload {
  serialNumber: string;
  platform: WalletPlatform;
  /** New base64-encoded QR payload */
  newQRPayload: string;
}

// ---------------------------------------------------------------------------
// Apple Wallet registration (maps 1:1 to apple_pass_registrations DB table)
// ---------------------------------------------------------------------------

export interface ApplePassRegistration {
  id: string;
  deviceLibraryIdentifier: string;
  pushToken: string;
  passTypeIdentifier: string;
  serialNumber: string;
  registeredAt: Date;
}
