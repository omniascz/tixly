// ---------------------------------------------------------------------------
// Zone Access Checker — Vitest unit tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  hasZoneAccess,
  getAccessibleZonesForGate,
  buildDenialReason,
  validateScanRequest,
  formatScanResult,
} from "./zone-access-checker";
import type { Gate, ScanRequest } from "../types/zone-access.types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGate(overrides: Partial<Gate> = {}): Gate {
  return {
    id: "gate-1",
    event_id: "event-1",
    name: "Brána A",
    zone_ids: ["zone-a", "zone-b"],
    active: true,
    ...overrides,
  };
}

function makeScanRequest(overrides: Partial<ScanRequest> = {}): ScanRequest {
  return {
    code: "QR-ABC123",
    gate_id: "gate-1",
    scanned_by_staff_id: "staff-1",
    scanned_at: new Date("2026-04-04T10:00:00Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// hasZoneAccess
// ---------------------------------------------------------------------------

describe("hasZoneAccess", () => {
  it("returns true when there is a direct intersection", () => {
    expect(hasZoneAccess(["zone-a", "zone-vip"], ["zone-a"])).toBe(true);
  });

  it("returns true when ticket has all gate zones (superset)", () => {
    expect(hasZoneAccess(["zone-a", "zone-b", "zone-vip"], ["zone-a", "zone-b"])).toBe(true);
  });

  it("returns false when there is no intersection", () => {
    expect(hasZoneAccess(["zone-vip", "backstage"], ["zone-a", "zone-b"])).toBe(false);
  });

  it("returns false when ticket zone list is empty", () => {
    expect(hasZoneAccess([], ["zone-a"])).toBe(false);
  });

  it("returns false when gate zone list is empty", () => {
    expect(hasZoneAccess(["zone-a"], [])).toBe(false);
  });

  it("returns false when both lists are empty", () => {
    expect(hasZoneAccess([], [])).toBe(false);
  });

  it("VIP ticket with multiple zones passes gate that serves one of them", () => {
    const vipZones = ["zone-a", "zone-vip", "backstage"];
    const gateZones = ["zone-vip"];
    expect(hasZoneAccess(vipZones, gateZones)).toBe(true);
  });

  it("returns false for single zone ticket at wrong gate", () => {
    expect(hasZoneAccess(["zone-a"], ["zone-vip"])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getAccessibleZonesForGate
// ---------------------------------------------------------------------------

describe("getAccessibleZonesForGate", () => {
  it("returns zones that are in both gate and ticket (subset)", () => {
    const gate = makeGate({ zone_ids: ["zone-a", "zone-b", "zone-vip"] });
    const result = getAccessibleZonesForGate(gate, ["zone-a"]);
    expect(result).toEqual(["zone-a"]);
  });

  it("returns all gate zones when ticket covers them all (superset)", () => {
    const gate = makeGate({ zone_ids: ["zone-a", "zone-b"] });
    const result = getAccessibleZonesForGate(gate, ["zone-a", "zone-b", "zone-vip"]);
    expect(result).toEqual(["zone-a", "zone-b"]);
  });

  it("returns empty array when no intersection exists", () => {
    const gate = makeGate({ zone_ids: ["zone-vip"] });
    const result = getAccessibleZonesForGate(gate, ["zone-a"]);
    expect(result).toEqual([]);
  });

  it("returns empty array when ticket zone list is empty", () => {
    const gate = makeGate({ zone_ids: ["zone-a"] });
    const result = getAccessibleZonesForGate(gate, []);
    expect(result).toEqual([]);
  });

  it("returns empty array when gate has no zones", () => {
    const gate = makeGate({ zone_ids: [] });
    const result = getAccessibleZonesForGate(gate, ["zone-a"]);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildDenialReason
// ---------------------------------------------------------------------------

describe("buildDenialReason", () => {
  it("returns Czech message for no_zone_access", () => {
    const msg = buildDenialReason("no_zone_access", "cs");
    expect(msg).toBeTruthy();
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(0);
  });

  it("returns English message for no_zone_access", () => {
    const msg = buildDenialReason("no_zone_access", "en");
    expect(msg).toContain("zone");
  });

  it("returns Czech message for already_scanned", () => {
    const msg = buildDenialReason("already_scanned", "cs");
    expect(msg).toBeTruthy();
    expect(msg).toContain("použita");
  });

  it("returns English message for already_scanned", () => {
    const msg = buildDenialReason("already_scanned", "en");
    expect(msg).toContain("scanned");
  });

  it("returns Czech message for invalid_ticket", () => {
    const msg = buildDenialReason("invalid_ticket", "cs");
    expect(msg).toContain("platná");
  });

  it("returns English message for invalid_ticket", () => {
    const msg = buildDenialReason("invalid_ticket", "en");
    expect(msg).toContain("valid");
  });

  it("returns Czech message for gate_inactive", () => {
    const msg = buildDenialReason("gate_inactive", "cs");
    expect(msg).toContain("aktivní");
  });

  it("returns English message for gate_inactive", () => {
    const msg = buildDenialReason("gate_inactive", "en");
    expect(msg).toContain("inactive");
  });

  it("cs and en messages for the same code are different strings", () => {
    const cs = buildDenialReason("no_zone_access", "cs");
    const en = buildDenialReason("no_zone_access", "en");
    expect(cs).not.toBe(en);
  });
});

// ---------------------------------------------------------------------------
// validateScanRequest
// ---------------------------------------------------------------------------

describe("validateScanRequest", () => {
  it("does not throw for a valid request", () => {
    expect(() => validateScanRequest(makeScanRequest())).not.toThrow();
  });

  it("throws when code is empty string", () => {
    expect(() => validateScanRequest(makeScanRequest({ code: "" }))).toThrow();
  });

  it("throws when code is whitespace only", () => {
    expect(() => validateScanRequest(makeScanRequest({ code: "   " }))).toThrow();
  });

  it("throws when gate_id is empty string", () => {
    expect(() => validateScanRequest(makeScanRequest({ gate_id: "" }))).toThrow();
  });

  it("throws when gate_id is whitespace only", () => {
    expect(() => validateScanRequest(makeScanRequest({ gate_id: "   " }))).toThrow();
  });

  it("throws when scanned_by_staff_id is empty", () => {
    expect(() =>
      validateScanRequest(makeScanRequest({ scanned_by_staff_id: "" }))
    ).toThrow();
  });

  it("throws when scanned_at is an invalid date", () => {
    expect(() =>
      validateScanRequest(makeScanRequest({ scanned_at: new Date("not-a-date") }))
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// formatScanResult
// ---------------------------------------------------------------------------

describe("formatScanResult", () => {
  it("formats an allowed scan result correctly", () => {
    const result = formatScanResult(
      true,
      {
        ticketId: "ticket-1",
        ticketTypeName: "VIP",
        holderName: "Jan Novák",
        zoneName: "VIP sekce",
        gateName: "Brána VIP",
      },
      "scan-abc"
    );

    expect(result.allowed).toBe(true);
    expect(result.ticket_id).toBe("ticket-1");
    expect(result.ticket_type_name).toBe("VIP");
    expect(result.holder_name).toBe("Jan Novák");
    expect(result.zone_name).toBe("VIP sekce");
    expect(result.gate_name).toBe("Brána VIP");
    expect(result.scan_id).toBe("scan-abc");
    expect(result.reason).toBeUndefined();
  });

  it("formats a denied scan result with reason", () => {
    const result = formatScanResult(
      false,
      {
        ticketId: "ticket-2",
        ticketTypeName: "Standard",
        holderName: "Petr Dvořák",
        zoneName: "VIP sekce",
        gateName: "Brána VIP",
        reason: "This ticket does not grant access to this zone.",
      },
      "scan-xyz"
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("This ticket does not grant access to this zone.");
    expect(result.scan_id).toBe("scan-xyz");
  });

  it("does not attach reason property when allowed and no reason given", () => {
    const result = formatScanResult(
      true,
      {
        ticketId: "t1",
        ticketTypeName: "Standard",
        holderName: "Eva",
        zoneName: "A",
        gateName: "G1",
      },
      "s1"
    );
    expect("reason" in result).toBe(false);
  });

  it("denied result without reason has no reason property", () => {
    const result = formatScanResult(
      false,
      {
        ticketId: "t2",
        ticketTypeName: "Standard",
        holderName: "Eva",
        zoneName: "A",
        gateName: "G1",
        // no reason
      },
      "s2"
    );
    expect(result.allowed).toBe(false);
    expect("reason" in result).toBe(false);
  });
});
