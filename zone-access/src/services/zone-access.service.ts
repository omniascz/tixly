// ---------------------------------------------------------------------------
// Zone Access Service
// ---------------------------------------------------------------------------

import { randomUUID } from "crypto";
import {
  hasZoneAccess,
  buildDenialReason,
  formatScanResult,
} from "../lib/zone-access-checker";
import {
  GateInactiveError,
  GateNotFoundError,
  TicketAlreadyScannedError,
  TicketNotFoundError,
  ZoneAccessDeniedError,
} from "../types/zone-access.types";
import type {
  Gate,
  ScanRecord,
  ScanRequest,
  ScanResult,
  Zone,
} from "../types/zone-access.types";

// ---------------------------------------------------------------------------
// DB Adapter interface — implement with your real DB (Prisma, Drizzle, etc.)
// ---------------------------------------------------------------------------

export interface ZoneAccessDbAdapter {
  // Scan flow
  findGateWithZones(gateId: string): Promise<(Gate & { zones: Zone[] }) | null>;
  findTicketForScan(code: string): Promise<{
    id: string;
    ticket_type_id: string;
    ticket_type_name: string;
    ticket_type_zone_ids: string[];
    holder_name: string;
    status: "active" | "used" | "cancelled" | "pending_installments";
    event_id: string;
  } | null>;
  getLastScanRecord(ticketId: string, zoneId: string): Promise<ScanRecord | null>;
  createScanRecord(data: Omit<ScanRecord, "id">): Promise<ScanRecord>;
  getZoneById(zoneId: string): Promise<Zone | null>;

  // Zone management
  createZone(data: Omit<Zone, "id">): Promise<Zone>;
  updateZone(id: string, data: Partial<Omit<Zone, "id">>): Promise<Zone>;
  deleteZone(id: string): Promise<void>;
  listZonesByEvent(eventId: string): Promise<Zone[]>;

  // Gate management
  createGate(data: Omit<Gate, "id">): Promise<Gate>;
  updateGate(id: string, data: Partial<Omit<Gate, "id">>): Promise<Gate>;
  listGatesByEvent(eventId: string): Promise<Gate[]>;

  // Zone rules
  setTicketTypeZones(ticketTypeId: string, zoneIds: string[]): Promise<void>;
  getTicketTypeZones(ticketTypeId: string): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// ZoneAccessService
// ---------------------------------------------------------------------------

export class ZoneAccessService {
  // -------------------------------------------------------------------------
  // processScan
  // Core scanning logic. Always resolves — never throws domain errors to the
  // caller; instead they are captured and returned as denied ScanResult.
  // The one exception: unexpected DB errors propagate as-is (let the route
  // handler return 500).
  // -------------------------------------------------------------------------
  async processScan(
    request: ScanRequest,
    db: ZoneAccessDbAdapter
  ): Promise<ScanResult> {
    const scanId = randomUUID();

    // 1. Resolve gate -------------------------------------------------------
    const gateWithZones = await db.findGateWithZones(request.gate_id);
    if (!gateWithZones) {
      throw new GateNotFoundError(request.gate_id);
    }
    if (!gateWithZones.active) {
      throw new GateInactiveError(request.gate_id);
    }

    // 2. Resolve ticket -----------------------------------------------------
    const ticket = await db.findTicketForScan(request.code);
    if (!ticket) {
      throw new TicketNotFoundError(request.code);
    }

    // 3. Ticket must be active ----------------------------------------------
    if (ticket.status !== "active") {
      const reason = buildDenialReason("invalid_ticket", "cs");
      await db.createScanRecord({
        ticket_id: ticket.id,
        gate_id: request.gate_id,
        zone_id: gateWithZones.zone_ids[0] ?? "",
        scanned_at: request.scanned_at,
        result: "denied",
        denial_reason: reason,
        staff_id: request.scanned_by_staff_id,
      });
      throw new ZoneAccessDeniedError("invalid_ticket", reason);
    }

    // 4. Zone access check --------------------------------------------------
    const gateZoneIds = gateWithZones.zone_ids;
    if (!hasZoneAccess(ticket.ticket_type_zone_ids, gateZoneIds)) {
      const reason = buildDenialReason("no_zone_access", "cs");
      await db.createScanRecord({
        ticket_id: ticket.id,
        gate_id: request.gate_id,
        zone_id: gateZoneIds[0] ?? "",
        scanned_at: request.scanned_at,
        result: "denied",
        denial_reason: reason,
        staff_id: request.scanned_by_staff_id,
      });
      throw new ZoneAccessDeniedError("no_zone_access", reason);
    }

    // Determine the specific zone to record — first overlapping zone
    const ticketZoneSet = new Set(ticket.ticket_type_zone_ids);
    const accessibleZoneId =
      gateZoneIds.find((id) => ticketZoneSet.has(id)) ?? gateZoneIds[0]!;

    // 5. Anti-double-entry — same zone only ---------------------------------
    const lastScan = await db.getLastScanRecord(ticket.id, accessibleZoneId);
    if (lastScan && lastScan.result === "allowed") {
      const reason = buildDenialReason("already_scanned", "cs");
      await db.createScanRecord({
        ticket_id: ticket.id,
        gate_id: request.gate_id,
        zone_id: accessibleZoneId,
        scanned_at: request.scanned_at,
        result: "denied",
        denial_reason: reason,
        staff_id: request.scanned_by_staff_id,
      });
      throw new TicketAlreadyScannedError(ticket.id, lastScan.id);
    }

    // 6. Resolve zone name for result display --------------------------------
    const zoneRecord =
      gateWithZones.zones.find((z) => z.id === accessibleZoneId) ?? null;
    const zoneName = zoneRecord?.name ?? accessibleZoneId;

    // 7. Create allowed scan record -----------------------------------------
    const record = await db.createScanRecord({
      ticket_id: ticket.id,
      gate_id: request.gate_id,
      zone_id: accessibleZoneId,
      scanned_at: request.scanned_at,
      result: "allowed",
      denial_reason: null,
      staff_id: request.scanned_by_staff_id,
    });

    // 8. Build and return ScanResult ----------------------------------------
    return formatScanResult(
      true,
      {
        ticketId: ticket.id,
        ticketTypeName: ticket.ticket_type_name,
        holderName: ticket.holder_name,
        zoneName,
        gateName: gateWithZones.name,
      },
      record.id
    );
  }

  // -------------------------------------------------------------------------
  // Zone management
  // -------------------------------------------------------------------------

  async createZone(
    eventId: string,
    _organizerId: string,
    data: Omit<Zone, "id" | "event_id">,
    db: ZoneAccessDbAdapter
  ): Promise<Zone> {
    return db.createZone({ ...data, event_id: eventId });
  }

  async updateZone(
    zoneId: string,
    _organizerId: string,
    data: Partial<Omit<Zone, "id" | "event_id">>,
    db: ZoneAccessDbAdapter
  ): Promise<Zone> {
    return db.updateZone(zoneId, data);
  }

  async deleteZone(
    zoneId: string,
    _organizerId: string,
    db: ZoneAccessDbAdapter
  ): Promise<void> {
    return db.deleteZone(zoneId);
  }

  async listEventZones(
    eventId: string,
    db: ZoneAccessDbAdapter
  ): Promise<Zone[]> {
    return db.listZonesByEvent(eventId);
  }

  // -------------------------------------------------------------------------
  // Gate management
  // -------------------------------------------------------------------------

  async createGate(
    eventId: string,
    data: Omit<Gate, "id" | "event_id">,
    db: ZoneAccessDbAdapter
  ): Promise<Gate> {
    return db.createGate({ ...data, event_id: eventId });
  }

  async updateGate(
    gateId: string,
    data: Partial<Omit<Gate, "id" | "event_id">>,
    db: ZoneAccessDbAdapter
  ): Promise<Gate> {
    return db.updateGate(gateId, data);
  }

  async listEventGates(
    eventId: string,
    db: ZoneAccessDbAdapter
  ): Promise<Gate[]> {
    return db.listGatesByEvent(eventId);
  }

  // -------------------------------------------------------------------------
  // Zone rules
  // -------------------------------------------------------------------------

  async setTicketTypeZones(
    ticketTypeId: string,
    zoneIds: string[],
    db: ZoneAccessDbAdapter
  ): Promise<void> {
    return db.setTicketTypeZones(ticketTypeId, zoneIds);
  }
}
