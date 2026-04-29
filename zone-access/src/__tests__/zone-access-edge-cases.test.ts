import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZoneAccessService } from '../services/zone-access.service';
import type { ZoneAccessDbAdapter } from '../services/zone-access.service';
import type { Zone, Gate, ScanRequest, ScanRecord } from '../types/zone-access.types';
import {
  ZoneNotFoundError,
  GateNotFoundError,
  TicketNotFoundError,
  ZoneAccessDeniedError,
  TicketAlreadyScannedError,
  TicketInvalidError,
  GateInactiveError,
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

const EVENT_ID = 'event-edge-001';
const GATE_ID = 'gate-edge-001';
const ZONE_A_ID = 'zone-edge-a';
const ZONE_B_ID = 'zone-edge-b';
const ZONE_C_ID = 'zone-edge-c';
const TICKET_ID = 'ticket-edge-001';
const TICKET_CODE = 'EDGE-123456';
const STAFF_ID = 'staff-edge-001';

const ZONE_A: Zone = {
  id: ZONE_A_ID,
  event_id: EVENT_ID,
  name: 'Zone A',
  description: null,
  color: '#ff0000',
  capacity: 100,
  sort_order: 0,
};

const ZONE_B: Zone = {
  id: ZONE_B_ID,
  event_id: EVENT_ID,
  name: 'Zone B',
  description: 'Secondary zone',
  color: '#00ff00',
  capacity: 200,
  sort_order: 1,
};

const ZONE_C: Zone = {
  id: ZONE_C_ID,
  event_id: EVENT_ID,
  name: 'Zone C',
  description: null,
  color: '#0000ff',
  capacity: null,
  sort_order: 2,
};

const MULTI_ZONE_GATE: Gate & { zones: Zone[] } = {
  id: GATE_ID,
  event_id: EVENT_ID,
  name: 'Multi-zone Gate',
  zone_ids: [ZONE_A_ID, ZONE_B_ID, ZONE_C_ID],
  active: true,
  zones: [ZONE_A, ZONE_B, ZONE_C],
};

const SINGLE_ZONE_GATE: Gate & { zones: Zone[] } = {
  id: GATE_ID,
  event_id: EVENT_ID,
  name: 'Single Gate',
  zone_ids: [ZONE_A_ID],
  active: true,
  zones: [ZONE_A],
};

function makeTicket(overrides: Partial<{
  id: string;
  ticket_type_id: string;
  ticket_type_name: string;
  ticket_type_zone_ids: string[];
  holder_name: string;
  status: 'active' | 'used' | 'cancelled' | 'pending_installments';
  event_id: string;
}> = {}) {
  return {
    id: TICKET_ID,
    ticket_type_id: 'type-edge-001',
    ticket_type_name: 'Standard',
    ticket_type_zone_ids: [ZONE_A_ID],
    holder_name: 'Jane Edge',
    status: 'active' as const,
    event_id: EVENT_ID,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<ScanRequest> = {}): ScanRequest {
  return {
    gate_id: GATE_ID,
    code: TICKET_CODE,
    scanned_at: new Date('2026-04-11T10:00:00Z'),
    scanned_by_staff_id: STAFF_ID,
    ...overrides,
  };
}

function makeScanRecord(overrides: Partial<ScanRecord> = {}): ScanRecord {
  return {
    id: 'scan-edge-001',
    ticket_id: TICKET_ID,
    gate_id: GATE_ID,
    zone_id: ZONE_A_ID,
    scanned_at: new Date('2026-04-11T10:00:00Z'),
    result: 'allowed',
    denial_reason: null,
    staff_id: STAFF_ID,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ZoneAccessService — edge cases', () => {
  let service: ZoneAccessService;
  let db: ZoneAccessDbAdapter;

  beforeEach(() => {
    service = new ZoneAccessService();
    db = makeMockDb();
  });

  // =========================================================================
  // Error class validation
  // =========================================================================

  describe('Error classes', () => {
    it('ZoneNotFoundError has correct code, name, and message', () => {
      const err = new ZoneNotFoundError('z-123');
      expect(err.code).toBe('ZONE_NOT_FOUND');
      expect(err.name).toBe('ZoneNotFoundError');
      expect(err.message).toBe('Zone not found: z-123');
      expect(err).toBeInstanceOf(Error);
    });

    it('GateNotFoundError has correct code, name, and message', () => {
      const err = new GateNotFoundError('g-456');
      expect(err.code).toBe('GATE_NOT_FOUND');
      expect(err.name).toBe('GateNotFoundError');
      expect(err.message).toBe('Gate not found: g-456');
      expect(err).toBeInstanceOf(Error);
    });

    it('TicketNotFoundError has correct code, name, and message', () => {
      const err = new TicketNotFoundError('TKT-789');
      expect(err.code).toBe('TICKET_NOT_FOUND');
      expect(err.name).toBe('TicketNotFoundError');
      expect(err.message).toBe('Ticket not found for code: TKT-789');
      expect(err).toBeInstanceOf(Error);
    });

    it('ZoneAccessDeniedError stores denialCode "no_zone_access"', () => {
      const err = new ZoneAccessDeniedError('no_zone_access', 'No access');
      expect(err.code).toBe('ZONE_ACCESS_DENIED');
      expect(err.name).toBe('ZoneAccessDeniedError');
      expect(err.denialCode).toBe('no_zone_access');
      expect(err.message).toBe('No access');
      expect(err).toBeInstanceOf(Error);
    });

    it('ZoneAccessDeniedError stores denialCode "invalid_ticket"', () => {
      const err = new ZoneAccessDeniedError('invalid_ticket', 'Invalid');
      expect(err.denialCode).toBe('invalid_ticket');
      expect(err.code).toBe('ZONE_ACCESS_DENIED');
    });

    it('TicketAlreadyScannedError stores existingScanId', () => {
      const err = new TicketAlreadyScannedError('t-1', 'scan-existing-99');
      expect(err.code).toBe('TICKET_ALREADY_SCANNED');
      expect(err.name).toBe('TicketAlreadyScannedError');
      expect(err.existingScanId).toBe('scan-existing-99');
      expect(err.message).toBe('Ticket already scanned: t-1');
      expect(err).toBeInstanceOf(Error);
    });

    it('TicketInvalidError has correct code, name, status, and message', () => {
      const err = new TicketInvalidError('t-2', 'cancelled');
      expect(err.code).toBe('TICKET_INVALID');
      expect(err.name).toBe('TicketInvalidError');
      expect(err.status).toBe('cancelled');
      expect(err.message).toBe('Ticket t-2 is not active (status: cancelled)');
      expect(err).toBeInstanceOf(Error);
    });

    it('GateInactiveError has correct code, name, and message', () => {
      const err = new GateInactiveError('g-off');
      expect(err.code).toBe('GATE_INACTIVE');
      expect(err.name).toBe('GateInactiveError');
      expect(err.message).toBe('Gate is inactive: g-off');
      expect(err).toBeInstanceOf(Error);
    });
  });

  // =========================================================================
  // processScan — ticket status rejections
  // =========================================================================

  describe('processScan — inactive ticket statuses', () => {
    it('rejects ticket with status "used" via ZoneAccessDeniedError with denialCode "invalid_ticket"', async () => {
      vi.mocked(db.findGateWithZones).mockResolvedValue(SINGLE_ZONE_GATE);
      vi.mocked(db.findTicketForScan).mockResolvedValue(makeTicket({ status: 'used' }));
      vi.mocked(db.createScanRecord).mockResolvedValue(makeScanRecord({ result: 'denied' }));

      try {
        await service.processScan(makeRequest(), db);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ZoneAccessDeniedError);
        expect((err as ZoneAccessDeniedError).denialCode).toBe('invalid_ticket');
      }
    });

    it('rejects ticket with status "cancelled" via ZoneAccessDeniedError with denialCode "invalid_ticket"', async () => {
      vi.mocked(db.findGateWithZones).mockResolvedValue(SINGLE_ZONE_GATE);
      vi.mocked(db.findTicketForScan).mockResolvedValue(makeTicket({ status: 'cancelled' }));
      vi.mocked(db.createScanRecord).mockResolvedValue(makeScanRecord({ result: 'denied' }));

      try {
        await service.processScan(makeRequest(), db);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ZoneAccessDeniedError);
        expect((err as ZoneAccessDeniedError).denialCode).toBe('invalid_ticket');
      }
    });

    it('rejects ticket with status "pending_installments" via ZoneAccessDeniedError', async () => {
      vi.mocked(db.findGateWithZones).mockResolvedValue(SINGLE_ZONE_GATE);
      vi.mocked(db.findTicketForScan).mockResolvedValue(makeTicket({ status: 'pending_installments' }));
      vi.mocked(db.createScanRecord).mockResolvedValue(makeScanRecord({ result: 'denied' }));

      try {
        await service.processScan(makeRequest(), db);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ZoneAccessDeniedError);
        expect((err as ZoneAccessDeniedError).denialCode).toBe('invalid_ticket');
      }
    });
  });

  // =========================================================================
  // processScan — denied scan records are persisted
  // =========================================================================

  describe('processScan — denied scan records', () => {
    it('records a denied scan when ticket status is inactive', async () => {
      vi.mocked(db.findGateWithZones).mockResolvedValue(SINGLE_ZONE_GATE);
      vi.mocked(db.findTicketForScan).mockResolvedValue(makeTicket({ status: 'cancelled' }));
      vi.mocked(db.createScanRecord).mockResolvedValue(makeScanRecord({ result: 'denied' }));

      await expect(service.processScan(makeRequest(), db)).rejects.toThrow(ZoneAccessDeniedError);

      expect(vi.mocked(db.createScanRecord)).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 'denied',
          ticket_id: TICKET_ID,
          gate_id: GATE_ID,
        })
      );
      // denial_reason should be a non-empty string
      const callArgs = vi.mocked(db.createScanRecord).mock.calls[0][0];
      expect(callArgs.denial_reason).toBeTruthy();
      expect(typeof callArgs.denial_reason).toBe('string');
    });

    it('records a denied scan when ticket has no zone access', async () => {
      vi.mocked(db.findGateWithZones).mockResolvedValue(SINGLE_ZONE_GATE);
      vi.mocked(db.findTicketForScan).mockResolvedValue(
        makeTicket({ ticket_type_zone_ids: ['unrelated-zone'] })
      );
      vi.mocked(db.createScanRecord).mockResolvedValue(makeScanRecord({ result: 'denied' }));

      await expect(service.processScan(makeRequest(), db)).rejects.toThrow(ZoneAccessDeniedError);

      expect(vi.mocked(db.createScanRecord)).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 'denied',
          ticket_id: TICKET_ID,
        })
      );
    });

    it('records a denied scan when ticket is already scanned', async () => {
      const existingScan = makeScanRecord({ id: 'scan-prev-001', result: 'allowed' });

      vi.mocked(db.findGateWithZones).mockResolvedValue(SINGLE_ZONE_GATE);
      vi.mocked(db.findTicketForScan).mockResolvedValue(makeTicket());
      vi.mocked(db.getLastScanRecord).mockResolvedValue(existingScan);
      vi.mocked(db.createScanRecord).mockResolvedValue(makeScanRecord({ result: 'denied' }));

      await expect(service.processScan(makeRequest(), db)).rejects.toThrow(TicketAlreadyScannedError);

      expect(vi.mocked(db.createScanRecord)).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 'denied',
          ticket_id: TICKET_ID,
          zone_id: ZONE_A_ID,
        })
      );
    });

    it('TicketAlreadyScannedError carries the existing scan ID', async () => {
      const existingScan = makeScanRecord({ id: 'scan-original-777', result: 'allowed' });

      vi.mocked(db.findGateWithZones).mockResolvedValue(SINGLE_ZONE_GATE);
      vi.mocked(db.findTicketForScan).mockResolvedValue(makeTicket());
      vi.mocked(db.getLastScanRecord).mockResolvedValue(existingScan);
      vi.mocked(db.createScanRecord).mockResolvedValue(makeScanRecord({ result: 'denied' }));

      try {
        await service.processScan(makeRequest(), db);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TicketAlreadyScannedError);
        expect((err as TicketAlreadyScannedError).existingScanId).toBe('scan-original-777');
      }
    });
  });

  // =========================================================================
  // processScan — multi-zone gate logic
  // =========================================================================

  describe('processScan — multi-zone gate', () => {
    it('picks the first overlapping zone when gate serves multiple zones', async () => {
      // Gate has zones [A, B, C], ticket has access to [B, C]
      // Should pick B (first overlap in gate order)
      vi.mocked(db.findGateWithZones).mockResolvedValue(MULTI_ZONE_GATE);
      vi.mocked(db.findTicketForScan).mockResolvedValue(
        makeTicket({ ticket_type_zone_ids: [ZONE_B_ID, ZONE_C_ID] })
      );
      vi.mocked(db.getLastScanRecord).mockResolvedValue(null);
      vi.mocked(db.createScanRecord).mockResolvedValue(
        makeScanRecord({ zone_id: ZONE_B_ID, id: 'scan-multi-001' })
      );

      const result = await service.processScan(makeRequest(), db);

      expect(result.allowed).toBe(true);
      // Verify the scan record was created with zone B (first overlap)
      expect(vi.mocked(db.createScanRecord)).toHaveBeenCalledWith(
        expect.objectContaining({ zone_id: ZONE_B_ID })
      );
      expect(result.zone_name).toBe('Zone B');
    });

    it('picks the first overlapping zone when ticket has only zone C', async () => {
      // Gate has [A, B, C], ticket only has [C]
      vi.mocked(db.findGateWithZones).mockResolvedValue(MULTI_ZONE_GATE);
      vi.mocked(db.findTicketForScan).mockResolvedValue(
        makeTicket({ ticket_type_zone_ids: [ZONE_C_ID] })
      );
      vi.mocked(db.getLastScanRecord).mockResolvedValue(null);
      vi.mocked(db.createScanRecord).mockResolvedValue(
        makeScanRecord({ zone_id: ZONE_C_ID, id: 'scan-multi-002' })
      );

      const result = await service.processScan(makeRequest(), db);

      expect(result.allowed).toBe(true);
      expect(vi.mocked(db.createScanRecord)).toHaveBeenCalledWith(
        expect.objectContaining({ zone_id: ZONE_C_ID })
      );
    });

    it('denies when gate zones and ticket zones have no intersection', async () => {
      vi.mocked(db.findGateWithZones).mockResolvedValue(SINGLE_ZONE_GATE); // only ZONE_A
      vi.mocked(db.findTicketForScan).mockResolvedValue(
        makeTicket({ ticket_type_zone_ids: [ZONE_B_ID, ZONE_C_ID] })
      );
      vi.mocked(db.createScanRecord).mockResolvedValue(makeScanRecord({ result: 'denied' }));

      try {
        await service.processScan(makeRequest(), db);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ZoneAccessDeniedError);
        expect((err as ZoneAccessDeniedError).denialCode).toBe('no_zone_access');
      }
    });

    it('denies when ticket has empty zone list', async () => {
      vi.mocked(db.findGateWithZones).mockResolvedValue(SINGLE_ZONE_GATE);
      vi.mocked(db.findTicketForScan).mockResolvedValue(
        makeTicket({ ticket_type_zone_ids: [] })
      );
      vi.mocked(db.createScanRecord).mockResolvedValue(makeScanRecord({ result: 'denied' }));

      await expect(service.processScan(makeRequest(), db)).rejects.toThrow(ZoneAccessDeniedError);
    });
  });

  // =========================================================================
  // processScan — anti-double-entry edge cases
  // =========================================================================

  describe('processScan — anti-double-entry edge cases', () => {
    it('allows entry when last scan in zone was "denied" (not "allowed")', async () => {
      // A previous denied scan should NOT block a new entry
      const deniedScan = makeScanRecord({ result: 'denied', denial_reason: 'no_zone_access' });

      vi.mocked(db.findGateWithZones).mockResolvedValue(SINGLE_ZONE_GATE);
      vi.mocked(db.findTicketForScan).mockResolvedValue(makeTicket());
      vi.mocked(db.getLastScanRecord).mockResolvedValue(deniedScan);
      vi.mocked(db.createScanRecord).mockResolvedValue(
        makeScanRecord({ id: 'scan-new-001', result: 'allowed' })
      );

      const result = await service.processScan(makeRequest(), db);
      expect(result.allowed).toBe(true);
    });

    it('allows entry when no previous scan exists (null)', async () => {
      vi.mocked(db.findGateWithZones).mockResolvedValue(SINGLE_ZONE_GATE);
      vi.mocked(db.findTicketForScan).mockResolvedValue(makeTicket());
      vi.mocked(db.getLastScanRecord).mockResolvedValue(null);
      vi.mocked(db.createScanRecord).mockResolvedValue(
        makeScanRecord({ id: 'scan-first', result: 'allowed' })
      );

      const result = await service.processScan(makeRequest(), db);
      expect(result.allowed).toBe(true);
      expect(result.scan_id).toBe('scan-first');
    });
  });

  // =========================================================================
  // processScan — result shape validation
  // =========================================================================

  describe('processScan — ScanResult shape', () => {
    it('returns all expected fields on a successful scan', async () => {
      vi.mocked(db.findGateWithZones).mockResolvedValue(SINGLE_ZONE_GATE);
      vi.mocked(db.findTicketForScan).mockResolvedValue(
        makeTicket({ holder_name: 'Alice Test', ticket_type_name: 'Premium' })
      );
      vi.mocked(db.getLastScanRecord).mockResolvedValue(null);
      vi.mocked(db.createScanRecord).mockResolvedValue(
        makeScanRecord({ id: 'scan-shape-001' })
      );

      const result = await service.processScan(makeRequest(), db);

      expect(result).toEqual({
        allowed: true,
        ticket_id: TICKET_ID,
        ticket_type_name: 'Premium',
        holder_name: 'Alice Test',
        zone_name: 'Zone A',
        gate_name: 'Single Gate',
        scan_id: 'scan-shape-001',
      });
      // reason should NOT be present on allowed result
      expect(result.reason).toBeUndefined();
    });
  });

  // =========================================================================
  // Zone CRUD operations — delegation to db adapter
  // =========================================================================

  describe('Zone CRUD operations', () => {
    it('createZone passes event_id and data to db adapter', async () => {
      const created = { ...ZONE_A, name: 'New Zone' };
      vi.mocked(db.createZone).mockResolvedValue(created);

      const result = await service.createZone(
        EVENT_ID,
        'org-1',
        { name: 'New Zone', description: null, color: '#ff0000', capacity: 100, sort_order: 0 },
        db
      );

      expect(result.name).toBe('New Zone');
      expect(vi.mocked(db.createZone)).toHaveBeenCalledWith(
        expect.objectContaining({ event_id: EVENT_ID, name: 'New Zone' })
      );
    });

    it('updateZone passes partial data to db adapter', async () => {
      const updated = { ...ZONE_A, name: 'Renamed Zone', capacity: 999 };
      vi.mocked(db.updateZone).mockResolvedValue(updated);

      const result = await service.updateZone(ZONE_A_ID, 'org-1', { name: 'Renamed Zone', capacity: 999 }, db);

      expect(result.name).toBe('Renamed Zone');
      expect(result.capacity).toBe(999);
      expect(vi.mocked(db.updateZone)).toHaveBeenCalledWith(ZONE_A_ID, { name: 'Renamed Zone', capacity: 999 });
    });

    it('deleteZone delegates to db adapter with correct zone ID', async () => {
      vi.mocked(db.deleteZone).mockResolvedValue(undefined);

      await service.deleteZone(ZONE_A_ID, 'org-1', db);

      expect(vi.mocked(db.deleteZone)).toHaveBeenCalledWith(ZONE_A_ID);
      expect(vi.mocked(db.deleteZone)).toHaveBeenCalledTimes(1);
    });

    it('listEventZones returns all zones for an event', async () => {
      vi.mocked(db.listZonesByEvent).mockResolvedValue([ZONE_A, ZONE_B, ZONE_C]);

      const result = await service.listEventZones(EVENT_ID, db);

      expect(result).toHaveLength(3);
      expect(result.map((z) => z.id)).toEqual([ZONE_A_ID, ZONE_B_ID, ZONE_C_ID]);
      expect(vi.mocked(db.listZonesByEvent)).toHaveBeenCalledWith(EVENT_ID);
    });

    it('listEventZones returns empty array when no zones exist', async () => {
      vi.mocked(db.listZonesByEvent).mockResolvedValue([]);

      const result = await service.listEventZones('event-empty', db);

      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // Gate CRUD operations — delegation to db adapter
  // =========================================================================

  describe('Gate CRUD operations', () => {
    it('createGate passes event_id and data to db adapter', async () => {
      const gate: Gate = {
        id: 'gate-new-001',
        event_id: EVENT_ID,
        name: 'New Gate',
        zone_ids: [ZONE_A_ID, ZONE_B_ID],
        active: true,
      };
      vi.mocked(db.createGate).mockResolvedValue(gate);

      const result = await service.createGate(
        EVENT_ID,
        { name: 'New Gate', zone_ids: [ZONE_A_ID, ZONE_B_ID], active: true },
        db
      );

      expect(result.id).toBe('gate-new-001');
      expect(result.zone_ids).toEqual([ZONE_A_ID, ZONE_B_ID]);
      expect(vi.mocked(db.createGate)).toHaveBeenCalledWith(
        expect.objectContaining({ event_id: EVENT_ID, name: 'New Gate' })
      );
    });

    it('updateGate delegates partial update to db adapter', async () => {
      const updated: Gate = { ...SINGLE_ZONE_GATE, name: 'Renamed Gate', active: false };
      vi.mocked(db.updateGate).mockResolvedValue(updated);

      const result = await service.updateGate(GATE_ID, { name: 'Renamed Gate', active: false }, db);

      expect(result.name).toBe('Renamed Gate');
      expect(result.active).toBe(false);
      expect(vi.mocked(db.updateGate)).toHaveBeenCalledWith(GATE_ID, { name: 'Renamed Gate', active: false });
    });

    it('listEventGates returns all gates for an event', async () => {
      const gates: Gate[] = [
        { id: 'g1', event_id: EVENT_ID, name: 'Gate 1', zone_ids: [ZONE_A_ID], active: true },
        { id: 'g2', event_id: EVENT_ID, name: 'Gate 2', zone_ids: [ZONE_B_ID], active: false },
      ];
      vi.mocked(db.listGatesByEvent).mockResolvedValue(gates);

      const result = await service.listEventGates(EVENT_ID, db);

      expect(result).toHaveLength(2);
      expect(vi.mocked(db.listGatesByEvent)).toHaveBeenCalledWith(EVENT_ID);
    });

    it('listEventGates returns empty array when no gates exist', async () => {
      vi.mocked(db.listGatesByEvent).mockResolvedValue([]);

      const result = await service.listEventGates('event-no-gates', db);

      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // setTicketTypeZones — delegation
  // =========================================================================

  describe('setTicketTypeZones', () => {
    it('delegates to db adapter with correct arguments', async () => {
      vi.mocked(db.setTicketTypeZones).mockResolvedValue(undefined);

      await service.setTicketTypeZones('type-001', [ZONE_A_ID, ZONE_B_ID], db);

      expect(vi.mocked(db.setTicketTypeZones)).toHaveBeenCalledWith('type-001', [ZONE_A_ID, ZONE_B_ID]);
      expect(vi.mocked(db.setTicketTypeZones)).toHaveBeenCalledTimes(1);
    });

    it('delegates with empty zone list (removes all zone access)', async () => {
      vi.mocked(db.setTicketTypeZones).mockResolvedValue(undefined);

      await service.setTicketTypeZones('type-002', [], db);

      expect(vi.mocked(db.setTicketTypeZones)).toHaveBeenCalledWith('type-002', []);
    });
  });

  // =========================================================================
  // processScan — zone name resolution edge cases
  // =========================================================================

  describe('processScan — zone name resolution', () => {
    it('uses zone ID as fallback name when zone record is not in gate zones array', async () => {
      // Gate claims zone_ids includes a zone that is NOT in its zones array
      const gateWithMissingZone: Gate & { zones: Zone[] } = {
        id: GATE_ID,
        event_id: EVENT_ID,
        name: 'Partial Gate',
        zone_ids: ['zone-missing-from-array'],
        active: true,
        zones: [], // zone record not loaded
      };

      vi.mocked(db.findGateWithZones).mockResolvedValue(gateWithMissingZone);
      vi.mocked(db.findTicketForScan).mockResolvedValue(
        makeTicket({ ticket_type_zone_ids: ['zone-missing-from-array'] })
      );
      vi.mocked(db.getLastScanRecord).mockResolvedValue(null);
      vi.mocked(db.createScanRecord).mockResolvedValue(
        makeScanRecord({ id: 'scan-fallback', zone_id: 'zone-missing-from-array' })
      );

      const result = await service.processScan(makeRequest(), db);

      expect(result.allowed).toBe(true);
      // Falls back to zone ID as name
      expect(result.zone_name).toBe('zone-missing-from-array');
    });
  });
});
