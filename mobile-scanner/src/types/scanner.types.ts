// ---------------------------------------------------------------------------
// Core types for Tixly Mobile Scanner
// ---------------------------------------------------------------------------

export interface ValidationResult {
  success: boolean;
  ticketId: string;
  holderName: string;
  seatInfo: string;
  error?: string;
}

export interface TicketRow {
  ticket_id: string;
  totp_secret_encrypted: Uint8Array;
  totp_secret_iv: Uint8Array;
  status: "active" | "revoked" | "used";
  holder_name: string;
  seat_info: string;
  synced_at: number; // unix seconds
}

export interface ScannedTokenRow {
  ticket_id: string;
  totp_value: string;
  scanned_at: number; // unix seconds
}

export interface ScanRecord {
  id: string;
  ticketId: string;
  holderName: string;
  seatInfo: string;
  success: boolean;
  error?: string;
  scannedAt: string; // ISO
}

export interface SyncState {
  lastSyncAt: number | null; // unix timestamp
  totalCached: number;
}

export interface MetadataRow {
  key: string;
  value: string;
}

export interface TicketSyncRow {
  ticket_id: string;
  totp_secret_encrypted: string; // base64
  totp_secret_iv: string;        // base64
  status: "active" | "revoked" | "used";
  holder_name: string;
  seat_info: string;
  synced_at: number;
}
