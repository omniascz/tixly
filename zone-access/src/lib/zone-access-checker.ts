// ---------------------------------------------------------------------------
// Zone Access Checker — pure functions, no DB dependency
// ---------------------------------------------------------------------------

import type { Gate, ScanRequest, ScanResult } from "../types/zone-access.types";

// ---------------------------------------------------------------------------
// hasZoneAccess
// Returns true when at least one zone from the ticket type's allowed zones
// overlaps with the zones served by the gate (set intersection).
// ---------------------------------------------------------------------------
export function hasZoneAccess(
  ticketTypeZoneIds: string[],
  gateZoneIds: string[]
): boolean {
  if (ticketTypeZoneIds.length === 0 || gateZoneIds.length === 0) {
    return false;
  }
  const ticketSet = new Set(ticketTypeZoneIds);
  return gateZoneIds.some((id) => ticketSet.has(id));
}

// ---------------------------------------------------------------------------
// getAccessibleZonesForGate
// Returns the subset of gate's zone_ids that the ticket type can access.
// ---------------------------------------------------------------------------
export function getAccessibleZonesForGate(
  gate: Gate,
  ticketTypeZoneIds: string[]
): string[] {
  if (ticketTypeZoneIds.length === 0 || gate.zone_ids.length === 0) {
    return [];
  }
  const ticketSet = new Set(ticketTypeZoneIds);
  return gate.zone_ids.filter((id) => ticketSet.has(id));
}

// ---------------------------------------------------------------------------
// buildDenialReason
// Returns a human-readable denial message in the requested language.
// ---------------------------------------------------------------------------

export type DenialCode =
  | "no_zone_access"
  | "already_scanned"
  | "invalid_ticket"
  | "gate_inactive";

const DENIAL_MESSAGES: Record<DenialCode, Record<"cs" | "en", string>> = {
  no_zone_access: {
    cs: "Vstupenka neopravňuje ke vstupu do této zóny.",
    en: "This ticket does not grant access to this zone.",
  },
  already_scanned: {
    cs: "Vstupenka již byla použita v této zóně.",
    en: "This ticket has already been scanned for this zone.",
  },
  invalid_ticket: {
    cs: "Vstupenka není platná (expirovaná nebo zrušená).",
    en: "The ticket is not valid (expired or cancelled).",
  },
  gate_inactive: {
    cs: "Brána není aktivní.",
    en: "This gate is currently inactive.",
  },
};

export function buildDenialReason(
  code: DenialCode,
  lang: "cs" | "en"
): string {
  return DENIAL_MESSAGES[code][lang];
}

// ---------------------------------------------------------------------------
// validateScanRequest
// Throws a plain Error with a descriptive message when the request is invalid.
// Does NOT throw typed domain errors — validation failures are caller bugs,
// not domain events.
// ---------------------------------------------------------------------------
export function validateScanRequest(request: ScanRequest): void {
  if (!request.code || request.code.trim().length === 0) {
    throw new Error("ScanRequest.code must not be empty.");
  }
  if (!request.gate_id || request.gate_id.trim().length === 0) {
    throw new Error("ScanRequest.gate_id must not be empty.");
  }
  if (
    !request.scanned_by_staff_id ||
    request.scanned_by_staff_id.trim().length === 0
  ) {
    throw new Error("ScanRequest.scanned_by_staff_id must not be empty.");
  }
  if (!(request.scanned_at instanceof Date) || isNaN(request.scanned_at.getTime())) {
    throw new Error("ScanRequest.scanned_at must be a valid Date.");
  }
}

// ---------------------------------------------------------------------------
// formatScanResult
// Assembles the final ScanResult DTO from individual pieces.
// ---------------------------------------------------------------------------
export function formatScanResult(
  allowed: boolean,
  context: {
    ticketId: string;
    ticketTypeName: string;
    holderName: string;
    zoneName: string;
    gateName: string;
    reason?: string;
  },
  scanId: string
): ScanResult {
  const result: ScanResult = {
    allowed,
    ticket_id: context.ticketId,
    ticket_type_name: context.ticketTypeName,
    holder_name: context.holderName,
    zone_name: context.zoneName,
    gate_name: context.gateName,
    scan_id: scanId,
  };

  if (!allowed && context.reason !== undefined) {
    result.reason = context.reason;
  }

  return result;
}
