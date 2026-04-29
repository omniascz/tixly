// ---------------------------------------------------------------------------
// Zone Access — shared domain types
// ---------------------------------------------------------------------------

export interface Zone {
  id: string;
  event_id: string;
  name: string; // e.g. "Parterre", "VIP", "Backstage"
  description: string | null;
  color: string; // hex, e.g. "#ff6b35"
  capacity: number | null;
  sort_order: number;
}

export interface Gate {
  id: string;
  event_id: string;
  name: string; // e.g. "Brána A – hlavní vchod"
  zone_ids: string[]; // zones served by this gate
  active: boolean;
}

export interface ZoneAccessRule {
  ticket_type_id: string;
  zone_id: string;
}

export interface ScanResult {
  allowed: boolean;
  ticket_id: string;
  ticket_type_name: string;
  holder_name: string;
  zone_name: string;
  gate_name: string;
  reason?: string; // only when allowed = false
  scan_id: string; // ID of the scan record
}

export interface ScanRequest {
  code: string; // QR code or barcode
  gate_id: string;
  scanned_by_staff_id: string;
  scanned_at: Date;
}

export interface ScanRecord {
  id: string;
  ticket_id: string;
  gate_id: string;
  zone_id: string;
  scanned_at: Date;
  result: "allowed" | "denied";
  denial_reason: string | null;
  staff_id: string;
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export class ZoneNotFoundError extends Error {
  readonly code = "ZONE_NOT_FOUND" as const;
  constructor(zoneId: string) {
    super(`Zone not found: ${zoneId}`);
    this.name = "ZoneNotFoundError";
  }
}

export class GateNotFoundError extends Error {
  readonly code = "GATE_NOT_FOUND" as const;
  constructor(gateId: string) {
    super(`Gate not found: ${gateId}`);
    this.name = "GateNotFoundError";
  }
}

export class TicketNotFoundError extends Error {
  readonly code = "TICKET_NOT_FOUND" as const;
  constructor(code: string) {
    super(`Ticket not found for code: ${code}`);
    this.name = "TicketNotFoundError";
  }
}

export class ZoneAccessDeniedError extends Error {
  readonly code = "ZONE_ACCESS_DENIED" as const;
  readonly denialCode: "no_zone_access" | "invalid_ticket";
  constructor(
    denialCode: "no_zone_access" | "invalid_ticket",
    message: string
  ) {
    super(message);
    this.name = "ZoneAccessDeniedError";
    this.denialCode = denialCode;
  }
}

export class TicketAlreadyScannedError extends Error {
  readonly code = "TICKET_ALREADY_SCANNED" as const;
  readonly existingScanId: string;
  constructor(ticketId: string, existingScanId: string) {
    super(`Ticket already scanned: ${ticketId}`);
    this.name = "TicketAlreadyScannedError";
    this.existingScanId = existingScanId;
  }
}

export class TicketInvalidError extends Error {
  readonly code = "TICKET_INVALID" as const;
  readonly status: string;
  constructor(ticketId: string, status: string) {
    super(`Ticket ${ticketId} is not active (status: ${status})`);
    this.name = "TicketInvalidError";
    this.status = status;
  }
}

export class GateInactiveError extends Error {
  readonly code = "GATE_INACTIVE" as const;
  constructor(gateId: string) {
    super(`Gate is inactive: ${gateId}`);
    this.name = "GateInactiveError";
  }
}
