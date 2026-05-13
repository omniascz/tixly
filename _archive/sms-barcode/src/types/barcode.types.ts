// =============================================================================
// TYPY: SMS + Barcode (Code 128) systém
// =============================================================================

// ---------------------------------------------------------------------------
// Doménové typy
// ---------------------------------------------------------------------------

/**
 * Vstupenka obohacená o barcode data pro čtečky a SMS.
 * Mapuje na tickets.tickets JOIN catalog.events JOIN catalog.venues.
 */
export interface BarcodeTicket {
  id: string;                  // UUID vstupenky
  ticketTypeId: string;        // UUID ticket_type
  ownerId: string;             // UUID aktuálního vlastníka
  holderName: string;          // identity.users.name
  barcodeCode: string | null;  // TK-{YEAR}-{6 číslic}-{2 alfanum}
  shortCode: string | null;    // 8-char base62 pro URL /e/{shortCode}
  barcodeScannedAt: Date | null;
  barcodeScannedBy: string | null;  // gate device ID
  status: TicketStatus;
  // Event info (JOIN catalog.events)
  eventId: string;
  eventName: string;
  eventDateStart: Date;
  eventDateEnd: Date | null;
  // Venue info (JOIN catalog.venues)
  venueId: string;
  venueName: string;
  venueAddress: string;
  // Seat / zone info (JOIN catalog.ticket_types + catalog.seats)
  zone: string | null;
  seatInfo: string | null;     // Např. "Sektor A, řada 5, místo 12" nebo null pro stání
}

export type TicketStatus = 'valid' | 'used' | 'revoked' | 'transferred' | 'resale_listed';

/**
 * Výsledek skenování čárového kódu na turniketu.
 */
export interface BarcodeScanResult {
  valid: boolean;
  ticketId?: string;
  holderName?: string;
  eventName?: string;
  eventDate?: Date;
  seatInfo?: string | null;
  zone?: string | null;
  reason?: ScanErrorReason;
  scannedAt?: Date;           // pro already_scanned
  scannedBy?: string;         // pro already_scanned — gate device ID
}

export type ScanErrorReason =
  | 'already_scanned'
  | 'not_found'
  | 'expired'
  | 'invalid_format';

// ---------------------------------------------------------------------------
// SMS typy
// ---------------------------------------------------------------------------

export enum SmsStatus {
  Pending = 'pending',
  Sent = 'sent',
  Delivered = 'delivered',
  Failed = 'failed',
}

/**
 * Typ SMS záznamu — rozlišuje reminder (den před eventem) a delivery (ihned po koupi).
 */
export type SmsLogType = 'reminder' | 'delivery';

export interface SmsDelivery {
  smsLogId: number;           // tickets.sms_log.id (BIGSERIAL)
  ticketId: string;
  phone: string;              // E.164
  messageSid: string | null;  // Twilio Message SID
  status: SmsStatus;
  sentAt: Date | null;
  errorMessage: string | null;
}

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string;        // odesílací číslo nebo Messaging Service SID
  webhookBaseUrl: string;     // pro StatusCallback URL, např. "https://tixly.cz"
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export class ScanValidationError extends Error {
  constructor(
    message: string,
    public readonly reason: ScanErrorReason,
  ) {
    super(message);
    this.name = 'ScanValidationError';
  }
}

export class BarcodeNotFoundError extends ScanValidationError {
  constructor(code: string) {
    super(`Čárový kód nenalezen: ${code}`, 'not_found');
    this.name = 'BarcodeNotFoundError';
  }
}

export class BarcodeAlreadyScannedError extends ScanValidationError {
  constructor(
    public readonly scannedAt: Date,
    public readonly scannedBy: string,
  ) {
    super(
      `Čárový kód byl již naskenován v ${scannedAt.toISOString()} zařízením ${scannedBy}`,
      'already_scanned',
    );
    this.name = 'BarcodeAlreadyScannedError';
  }
}

export class TicketExpiredError extends ScanValidationError {
  constructor(eventEndAt: Date) {
    super(
      `Vstupenka expirovala: event skončil ${eventEndAt.toISOString()}`,
      'expired',
    );
    this.name = 'TicketExpiredError';
  }
}

export class InvalidBarcodeFormatError extends ScanValidationError {
  constructor(raw: string) {
    super(`Neplatný formát čárového kódu: "${raw}"`, 'invalid_format');
    this.name = 'InvalidBarcodeFormatError';
  }
}

// ---------------------------------------------------------------------------
// Dependency injection adaptery (interfaces)
// ---------------------------------------------------------------------------

/**
 * Databázový adaptér — injektován do services pro testovatelnost.
 * Produkční implementace používá pg (node-postgres).
 */
export interface DbAdapter {
  /** Vrátí vstupenku s kompletními JOIN daty pro barcode operace */
  getTicketWithEventByBarcode(barcodeCode: string): Promise<BarcodeTicket | null>;

  /** Vrátí vstupenku dle short_code pro webovou stránku */
  getTicketByShortCode(shortCode: string): Promise<BarcodeTicket | null>;

  /** Vrátí vstupenku dle ID */
  getTicketById(ticketId: string): Promise<BarcodeTicket | null>;

  /** Přiřadí barcode_code a short_code, pouze pokud jsou NULL (idempotentní) */
  assignBarcodeCodes(
    ticketId: string,
    barcodeCode: string,
    shortCode: string,
  ): Promise<boolean>;

  /** Atomicky označí vstupenku jako naskenovanou (UPDATE ... WHERE barcode_scanned_at IS NULL) */
  markBarcodeScanned(
    ticketId: string,
    deviceId: string,
    scannedAt: Date,
  ): Promise<boolean>;

  /** Zkontroluj existenci barcode_code (pro detekci kolize) */
  barcodeCodeExists(barcodeCode: string): Promise<boolean>;

  /** Zkontroluj existenci short_code (pro detekci kolize) */
  shortCodeExists(shortCode: string): Promise<boolean>;

  /** Vrátí vstupenky na eventy zítra, kde ještě nebyla poslána SMS */
  getTicketsForSmsReminder(): Promise<SmsReminderRow[]>;

  /** Vloží záznam do tickets.sms_log */
  insertSmsLog(entry: InsertSmsLog): Promise<number>;

  /** Aktualizuje status v tickets.sms_log dle Twilio MessageSid */
  updateSmsLogStatus(
    messageSid: string,
    status: SmsStatus,
  ): Promise<void>;

  /**
   * Vrátí nejnovější SMS log záznam pro danou vstupenku a typ (reminder/delivery).
   * Slouží k idempotenci — zabrání duplicitnímu odeslání SMS.
   */
  findSmsLogByTicketAndType(
    ticketId: string,
    type: SmsLogType,
  ): Promise<SmsDelivery | null>;
}

export interface SmsReminderRow {
  ticketId: string;
  barcodeCode: string | null;
  shortCode: string | null;
  phone: string;           // E.164
  eventName: string;
  eventDateStart: Date;
  venueName: string;
  venueAddress: string;
  holderName: string;
}

export interface InsertSmsLog {
  ticketId: string;
  phone: string;
  messageSid: string | null;
  status: SmsStatus;
  sentAt: Date | null;
  errorMessage: string | null;
  /** Typ SMS — default 'reminder' pro zpětnou kompatibilitu */
  type?: SmsLogType;
}

/**
 * SMS provider adaptér — umožňuje mockování v testech bez Twilio.
 */
export interface SmsProviderAdapter {
  send(to: string, body: string, statusCallbackUrl: string): Promise<SmsSendResult>;
}

export interface SmsSendResult {
  messageSid: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Pomocné typy
// ---------------------------------------------------------------------------

export interface BarcodeOptions {
  scale?: number;        // default 3 — multiplikátor velikosti pixelů
  height?: number;       // default 10 — výška v mm
  includeText?: boolean; // default true — text pod čárovým kódem
  textSize?: number;     // default 12 — velikost písma textu
}
