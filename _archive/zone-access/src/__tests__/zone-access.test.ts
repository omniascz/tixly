import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZoneAccessService } from '../services/zone-access.service';
import type { ZoneAccessDbAdapter } from '../services/zone-access.service';
import type { Zone, Gate, ScanRequest } from '../types/zone-access.types';
import {
  GateNotFoundError,
  GateInactiveError,
  TicketNotFoundError,
} from '../types/zone-access.types';

// ---------------------------------------------------------------------------
// Mock DB Adapter
// ---------------------------------------------------------------------------

function makeMockDb(): ZoneAccessDbAdapter {
  return {
    findGateWithZones: vi.fn(),
    findTicketForScan: vi.fn(),
    getLastScanRecord: vi.fn(),
    createScanRecord: vi.fn(),
    getZoneById: vi.fn(),
    createZone: vi.fn(),
    updateZone: vi.fn(),
    deleteZone: vi.fn(),
    listZonesByEvent: vi.fn(),
    createGate: vi.fn(),
    updateGate: vi.fn(),
    listGatesByEvent: vi.fn(),
    setTicketTypeZones: vi.fn(),
    getTicketTypeZones: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EVENT_ID = 'event-uuid-001';
const GATE_ID = 'gate-uuid-001';
const ZONE_ID = 'zone-uuid-001';
const TICKET_ID = 'ticket-uuid-001';
const TICKET_CODE = 'TKT-123456';
const STAFF_ID = 'staff-uuid-001';

const MOCK_ZONE: Zone = {
  id: ZONE_ID,
  event_id: EVENT_ID,
  name: 'Main Stage',
  description: 'Primary performance area',
  capacity: 500,
};

const MOCK_GATE: Gate & { zones: Zone[] } = {
  id: GATE_ID,
  event_id: EVENT_ID,
  name: 'Gate A',
  zone_ids: [ZONE_ID],
  active: true,
  zones: [MOCK_ZONE],
};

const MOCK_TICKET = {
  id: TICKET_ID,
  ticket_type_id: 'type-uuid-001',
  ticket_type_name: 'VIP',
  ticket_type_zone_ids: [ZONE_ID],
  holder_name: 'John Doe',
  status: 'active' as const,
  event_id: EVENT_ID,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ZoneAccessService', () => {
  let service: ZoneAccessService;
  let db: ZoneAccessDbAdapter;

  beforeEach(() => {
    service = new ZoneAccessService();
    db = makeMockDb();
  });

  // -------------------------------------------------------------------------
  // 1. processScan — allowed
  // -------------------------------------------------------------------------

  it('1. processScan — allows valid ticket with zone access', async () => {
    const request: ScanRequest = {
      gate_id: GATE_ID,
      code: TICKET_CODE,
      scanned_at: new Date(),
      scanned_by_staff_id: STAFF_ID,
    };

    vi.mocked(db.findGateWithZones).mockResolvedValue(MOCK_GATE);
    vi.mocked(db.findTicketForScan).mockResolvedValue(MOCK_TICKET);
    vi.mocked(db.getLastScanRecord).mockResolvedValue(null);
    vi.mocked(db.createScanRecord).mockResolvedValue({
      id: 'scan-uuid-001',
      ticket_id: TICKET_ID,
      gate_id: GATE_ID,
      zone_id: ZONE_ID,
      scanned_at: new Date(),
      result: 'allowed',
      denial_reason: null,
      staff_id: STAFF_ID,
    });

    const result = await service.processScan(request, db);

    expect(result.allowed).toBe(true);
    expect(result.holder_name).toBe('John Doe');
    expect(result.zone_name).toBe('Main Stage');
    expect(vi.mocked(db.createScanRecord)).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'allowed',
      })
    );
  });

  // -------------------------------------------------------------------------
  // 2. processScan — gate not found
  // -------------------------------------------------------------------------

  it('2. processScan — throws when gate not found', async () => {
    const request: ScanRequest = {
      gate_id: GATE_ID,
      code: TICKET_CODE,
      scanned_at: new Date(),
      scanned_by_staff_id: STAFF_ID,
    };

    vi.mocked(db.findGateWithZones).mockResolvedValue(null);

    await expect(service.processScan(request, db)).rejects.toThrow(GateNotFoundError);
  });

  // -------------------------------------------------------------------------
  // 3. processScan — gate inactive
  // -------------------------------------------------------------------------

  it('3. processScan — throws when gate inactive', async () => {
    const inactiveGate = { ...MOCK_GATE, active: false };
    const request: ScanRequest = {
      gate_id: GATE_ID,
      code: TICKET_CODE,
      scanned_at: new Date(),
      scanned_by_staff_id: STAFF_ID,
    };

    vi.mocked(db.findGateWithZones).mockResolvedValue(inactiveGate);

    await expect(service.processScan(request, db)).rejects.toThrow(GateInactiveError);
  });

  // -------------------------------------------------------------------------
  // 4. processScan — ticket not found
  // -------------------------------------------------------------------------

  it('4. processScan — throws when ticket not found', async () => {
    const request: ScanRequest = {
      gate_id: GATE_ID,
      code: TICKET_CODE,
      scanned_at: new Date(),
      scanned_by_staff_id: STAFF_ID,
    };

    vi.mocked(db.findGateWithZones).mockResolvedValue(MOCK_GATE);
    vi.mocked(db.findTicketForScan).mockResolvedValue(null);

    await expect(service.processScan(request, db)).rejects.toThrow(TicketNotFoundError);
  });

  // -------------------------------------------------------------------------
  // 5. processScan — zone access denied
  // -------------------------------------------------------------------------

  it('5. processScan — denies when ticket lacks zone access', async () => {
    const noAccessTicket = { ...MOCK_TICKET, ticket_type_zone_ids: ['other-zone'] };
    const request: ScanRequest = {
      gate_id: GATE_ID,
      code: TICKET_CODE,
      scanned_at: new Date(),
      scanned_by_staff_id: STAFF_ID,
    };

    vi.mocked(db.findGateWithZones).mockResolvedValue(MOCK_GATE);
    vi.mocked(db.findTicketForScan).mockResolvedValue(noAccessTicket);
    vi.mocked(db.createScanRecord).mockResolvedValue({
      id: 'scan-uuid-001',
      ticket_id: TICKET_ID,
      gate_id: GATE_ID,
      zone_id: ZONE_ID,
      scanned_at: new Date(),
      result: 'denied',
      denial_reason: 'no_zone_access',
      staff_id: STAFF_ID,
    });

    await expect(service.processScan(request, db)).rejects.toThrow();
    expect(vi.mocked(db.createScanRecord)).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 6. processScan — already scanned (double entry)
  // -------------------------------------------------------------------------

  it('6. processScan — denies when already scanned in same zone', async () => {
    const request: ScanRequest = {
      gate_id: GATE_ID,
      code: TICKET_CODE,
      scanned_at: new Date(),
      scanned_by_staff_id: STAFF_ID,
    };

    const lastScan = {
      id: 'scan-uuid-001',
      ticket_id: TICKET_ID,
      gate_id: GATE_ID,
      zone_id: ZONE_ID,
      scanned_at: new Date(),
      result: 'allowed' as const,
      denial_reason: null,
      staff_id: STAFF_ID,
    };

    vi.mocked(db.findGateWithZones).mockResolvedValue(MOCK_GATE);
    vi.mocked(db.findTicketForScan).mockResolvedValue(MOCK_TICKET);
    vi.mocked(db.getLastScanRecord).mockResolvedValue(lastScan);
    vi.mocked(db.createScanRecord).mockResolvedValue({
      id: 'scan-uuid-002',
      ticket_id: TICKET_ID,
      gate_id: GATE_ID,
      zone_id: ZONE_ID,
      scanned_at: new Date(),
      result: 'denied',
      denial_reason: 'already_scanned',
      staff_id: STAFF_ID,
    });

    await expect(service.processScan(request, db)).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // 7. createZone
  // -------------------------------------------------------------------------

  it('7. createZone — creates new zone', async () => {
    vi.mocked(db.createZone).mockResolvedValue(MOCK_ZONE);

    const result = await service.createZone(
      EVENT_ID,
      'org-uuid',
      {
        name: 'Main Stage',
        description: 'Primary performance area',
        capacity: 500,
      },
      db
    );

    expect(result.id).toBe(ZONE_ID);
    expect(result.name).toBe('Main Stage');
    expect(result.capacity).toBe(500);
  });

  // -------------------------------------------------------------------------
  // 8. updateZone
  // -------------------------------------------------------------------------

  it('8. updateZone — updates existing zone', async () => {
    const updated = { ...MOCK_ZONE, capacity: 600 };
    vi.mocked(db.updateZone).mockResolvedValue(updated);

    const result = await service.updateZone(
      ZONE_ID,
      'org-uuid',
      { capacity: 600 },
      db
    );

    expect(result.capacity).toBe(600);
  });

  // -------------------------------------------------------------------------
  // 9. deleteZone
  // -------------------------------------------------------------------------

  it('9. deleteZone — deletes zone', async () => {
    vi.mocked(db.deleteZone).mockResolvedValue(undefined);

    await service.deleteZone(ZONE_ID, 'org-uuid', db);

    expect(vi.mocked(db.deleteZone)).toHaveBeenCalledWith(ZONE_ID);
  });

  // -------------------------------------------------------------------------
  // 10. listEventZones
  // -------------------------------------------------------------------------

  it('10. listEventZones — returns all zones for event', async () => {
    vi.mocked(db.listZonesByEvent).mockResolvedValue([MOCK_ZONE]);

    const result = await service.listEventZones(EVENT_ID, db);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(ZONE_ID);
  });

  // -------------------------------------------------------------------------
  // 11. createGate
  // -------------------------------------------------------------------------

  it('11. createGate — creates gate with zones', async () => {
    const gate: Gate = {
      id: GATE_ID,
      event_id: EVENT_ID,
      name: 'Gate A',
      zone_ids: [ZONE_ID],
      active: true,
    };
    vi.mocked(db.createGate).mockResolvedValue(gate);

    const result = await service.createGate(
      EVENT_ID,
      {
        name: 'Gate A',
        zone_ids: [ZONE_ID],
        active: true,
      },
      db
    );

    expect(result.id).toBe(GATE_ID);
    expect(result.name).toBe('Gate A');
    expect(result.zone_ids).toContain(ZONE_ID);
  });

  // -------------------------------------------------------------------------
  // 12. updateGate
  // -------------------------------------------------------------------------

  it('12. updateGate — updates gate', async () => {
    const updated: Gate = { ...MOCK_GATE, active: false };
    vi.mocked(db.updateGate).mockResolvedValue(updated);

    const result = await service.updateGate(
      GATE_ID,
      { active: false },
      db
    );

    expect(result.active).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 13. listEventGates
  // -------------------------------------------------------------------------

  it('13. listEventGates — lists all gates for event', async () => {
    const gate: Gate = MOCK_GATE;
    vi.mocked(db.listGatesByEvent).mockResolvedValue([gate]);

    const result = await service.listEventGates(EVENT_ID, db);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(GATE_ID);
  });

  // -------------------------------------------------------------------------
  // 14. setTicketTypeZones
  // -------------------------------------------------------------------------

  it('14. setTicketTypeZones — assigns zones to ticket type', async () => {
    vi.mocked(db.setTicketTypeZones).mockResolvedValue(undefined);

    await service.setTicketTypeZones('type-uuid-001', [ZONE_ID], db);

    expect(vi.mocked(db.setTicketTypeZones)).toHaveBeenCalledWith('type-uuid-001', [ZONE_ID]);
  });

  // -------------------------------------------------------------------------
  // 15. Integration: Full flow
  // -------------------------------------------------------------------------

  it('15. Full flow: create zone → create gate → scan ticket', async () => {
    // Create zone
    vi.mocked(db.createZone).mockResolvedValue(MOCK_ZONE);
    const zone = await service.createZone(EVENT_ID, 'org-uuid', { name: 'Main Stage', capacity: 500 }, db);
    expect(zone.id).toBe(ZONE_ID);

    // Create gate
    const gate: Gate = {
      id: GATE_ID,
      event_id: EVENT_ID,
      name: 'Gate A',
      zone_ids: [ZONE_ID],
      active: true,
    };
    vi.mocked(db.createGate).mockResolvedValue(gate);
    const createdGate = await service.createGate(EVENT_ID, { name: 'Gate A', zone_ids: [ZONE_ID], active: true }, db);
    expect(createdGate.id).toBe(GATE_ID);

    // Scan ticket
    const request: ScanRequest = {
      gate_id: GATE_ID,
      code: TICKET_CODE,
      scanned_at: new Date(),
      scanned_by_staff_id: STAFF_ID,
    };
    vi.mocked(db.findGateWithZones).mockResolvedValue(MOCK_GATE);
    vi.mocked(db.findTicketForScan).mockResolvedValue(MOCK_TICKET);
    vi.mocked(db.getLastScanRecord).mockResolvedValue(null);
    vi.mocked(db.createScanRecord).mockResolvedValue({
      id: 'scan-uuid-001',
      ticket_id: TICKET_ID,
      gate_id: GATE_ID,
      zone_id: ZONE_ID,
      scanned_at: new Date(),
      result: 'allowed',
      denial_reason: null,
      staff_id: STAFF_ID,
    });

    const result = await service.processScan(request, db);
    expect(result.allowed).toBe(true);
  });
});
