import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReentryService } from '../services/re-entry.service';
import type { ReentryDbAdapter } from '../services/re-entry.service';
import type { ScanEvent, ReentryPolicy, TicketPresence } from '../types/re-entry.types';

// ---------------------------------------------------------------------------
// Mock DB Adapter
// ---------------------------------------------------------------------------

function makeMockDb(): ReentryDbAdapter {
  return {
    findScanHistory: vi.fn(),
    getReentryPolicy: vi.fn(),
    getDefaultPolicy: vi.fn(),
    getTicketTypeInfo: vi.fn(),
    recordScan: vi.fn(),
    createPolicy: vi.fn(),
    updatePolicy: vi.fn(),
    listPoliciesByEvent: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EVENT_ID = 'event-uuid-001';
const TICKET_ID = 'ticket-uuid-001';
const TICKET_TYPE_ID = 'type-uuid-001';
const GATE_ID = 'gate-uuid-001';
const STAFF_ID = 'staff-uuid-001';

const MOCK_SCAN_EVENT: ScanEvent = {
  id: 'scan-uuid-001',
  ticket_id: TICKET_ID,
  gate_id: GATE_ID,
  gate_type: 'entry',
  event_type: 'check_in',
  scanned_at: new Date(),
  staff_id: STAFF_ID,
  allowed: true,
  denial_reason: null,
};

const MOCK_POLICY: ReentryPolicy = {
  id: 'policy-uuid-001',
  event_id: EVENT_ID,
  ticket_type_id: TICKET_TYPE_ID,
  allowed: true,
  max_reentries: 3,
  vip_only: false,
  requires_exit_before_reentry: true,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReentryService', () => {
  let service: ReentryService;
  let db: ReentryDbAdapter;

  beforeEach(() => {
    service = new ReentryService();
    db = makeMockDb();
  });

  // -------------------------------------------------------------------------
  // 1. processScan — Check-in (first entry)
  // -------------------------------------------------------------------------

  it('1. processScan — check-in allowed for new ticket', async () => {
    vi.mocked(db.findScanHistory).mockResolvedValue([]);
    vi.mocked(db.getReentryPolicy).mockResolvedValue(MOCK_POLICY);
    vi.mocked(db.recordScan).mockResolvedValue(MOCK_SCAN_EVENT);

    const result = await service.processScan(
      TICKET_ID,
      TICKET_TYPE_ID,
      EVENT_ID,
      GATE_ID,
      'entry',
      STAFF_ID,
      db
    );

    expect(result.allowed).toBe(true);
    expect(result.event_type).toBe('check_in');
    expect(result.reentry_count).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 2. processScan — Check-out (always allowed)
  // -------------------------------------------------------------------------

  it('2. processScan — check-out always allowed', async () => {
    const scanHistory: ScanEvent[] = [
      { ...MOCK_SCAN_EVENT, id: 'scan-1', event_type: 'check_in' },
    ];
    vi.mocked(db.findScanHistory).mockResolvedValue(scanHistory);
    vi.mocked(db.recordScan).mockResolvedValue({ ...MOCK_SCAN_EVENT, event_type: 'check_out' });

    const result = await service.processScan(
      TICKET_ID,
      TICKET_TYPE_ID,
      EVENT_ID,
      GATE_ID,
      'exit',
      STAFF_ID,
      db
    );

    expect(result.allowed).toBe(true);
    expect(result.event_type).toBe('check_out');
    expect(vi.mocked(db.recordScan)).toHaveBeenCalledWith(expect.objectContaining({
      allowed: true,
    }));
  });

  // -------------------------------------------------------------------------
  // 3. processScan — Re-entry allowed
  // -------------------------------------------------------------------------

  it('3. processScan — re-entry allowed when exited', async () => {
    const scanHistory: ScanEvent[] = [
      { ...MOCK_SCAN_EVENT, id: 'scan-1', event_type: 'check_in' },
      { ...MOCK_SCAN_EVENT, id: 'scan-2', event_type: 'check_out' },
    ];
    vi.mocked(db.findScanHistory).mockResolvedValue(scanHistory);
    vi.mocked(db.getReentryPolicy).mockResolvedValue(MOCK_POLICY);
    vi.mocked(db.getTicketTypeInfo).mockResolvedValue({ isVip: false });
    vi.mocked(db.recordScan).mockResolvedValue(MOCK_SCAN_EVENT);

    const result = await service.processScan(
      TICKET_ID,
      TICKET_TYPE_ID,
      EVENT_ID,
      GATE_ID,
      'entry',
      STAFF_ID,
      db
    );

    expect(result.allowed).toBe(true);
    expect(result.event_type).toBe('reentry');
    expect(result.reentry_count).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 4. processScan — Re-entry blocked without exit
  // -------------------------------------------------------------------------

  it('4. processScan — re-entry blocked when already inside', async () => {
    const scanHistory: ScanEvent[] = [
      { ...MOCK_SCAN_EVENT, id: 'scan-1', event_type: 'check_in' },
    ];
    const policyWithExit: ReentryPolicy = {
      ...MOCK_POLICY,
      requires_exit_before_reentry: true,
    };
    vi.mocked(db.findScanHistory).mockResolvedValue(scanHistory);
    vi.mocked(db.getReentryPolicy).mockResolvedValue(policyWithExit);
    vi.mocked(db.getTicketTypeInfo).mockResolvedValue({ isVip: false });
    vi.mocked(db.recordScan).mockResolvedValue(MOCK_SCAN_EVENT);

    const result = await service.processScan(
      TICKET_ID,
      TICKET_TYPE_ID,
      EVENT_ID,
      GATE_ID,
      'entry',
      STAFF_ID,
      db
    );

    expect(result.allowed).toBe(false);
    expect(result.event_type).toBe('reentry');
    expect(result.reason).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 5. processScan — Re-entry limit exceeded
  // -------------------------------------------------------------------------

  it('5. processScan — re-entry blocked when limit exceeded', async () => {
    const scanHistory: ScanEvent[] = [
      { ...MOCK_SCAN_EVENT, id: 'scan-1', event_type: 'check_in' },
      { ...MOCK_SCAN_EVENT, id: 'scan-2', event_type: 'check_out' },
      { ...MOCK_SCAN_EVENT, id: 'scan-3', event_type: 'check_in' },
      { ...MOCK_SCAN_EVENT, id: 'scan-4', event_type: 'check_out' },
      { ...MOCK_SCAN_EVENT, id: 'scan-5', event_type: 'check_in' },
      { ...MOCK_SCAN_EVENT, id: 'scan-6', event_type: 'check_out' },
      { ...MOCK_SCAN_EVENT, id: 'scan-7', event_type: 'check_in' },
      { ...MOCK_SCAN_EVENT, id: 'scan-8', event_type: 'check_out' },
    ];
    const limitedPolicy: ReentryPolicy = { ...MOCK_POLICY, max_reentries: 2 };
    vi.mocked(db.findScanHistory).mockResolvedValue(scanHistory);
    vi.mocked(db.getReentryPolicy).mockResolvedValue(limitedPolicy);
    vi.mocked(db.getTicketTypeInfo).mockResolvedValue({ isVip: false });
    vi.mocked(db.recordScan).mockResolvedValue(MOCK_SCAN_EVENT);

    const result = await service.processScan(
      TICKET_ID,
      TICKET_TYPE_ID,
      EVENT_ID,
      GATE_ID,
      'entry',
      STAFF_ID,
      db
    );

    expect(result.allowed).toBe(false);
    expect(result.reentry_count).toBe(3);
    expect(result.max_reentries).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 6. setPolicy
  // -------------------------------------------------------------------------

  it('6. setPolicy — creates new policy', async () => {
    vi.mocked(db.getReentryPolicy).mockResolvedValue(null);
    vi.mocked(db.createPolicy).mockResolvedValue(MOCK_POLICY);

    const result = await service.setPolicy(
      EVENT_ID,
      'org-uuid',
      {
        ticket_type_id: TICKET_TYPE_ID,
        allowed: true,
        max_reentries: 3,
        vip_only: false,
        requires_exit_before_reentry: true,
      },
      db
    );

    expect(result.id).toBeDefined();
    expect(result.max_reentries).toBe(3);
  });

  it('7. setPolicy — updates existing policy', async () => {
    vi.mocked(db.getReentryPolicy).mockResolvedValue(MOCK_POLICY);
    vi.mocked(db.updatePolicy).mockResolvedValue({ ...MOCK_POLICY, max_reentries: 5 });

    const result = await service.setPolicy(
      EVENT_ID,
      'org-uuid',
      {
        ticket_type_id: TICKET_TYPE_ID,
        allowed: true,
        max_reentries: 5,
        vip_only: false,
        requires_exit_before_reentry: true,
      },
      db
    );

    expect(result.max_reentries).toBe(5);
    expect(vi.mocked(db.updatePolicy)).toHaveBeenCalledWith(MOCK_POLICY.id, expect.any(Object));
  });

  // -------------------------------------------------------------------------
  // 8. listEventPolicies
  // -------------------------------------------------------------------------

  it('8. listEventPolicies — returns all policies for event', async () => {
    vi.mocked(db.listPoliciesByEvent).mockResolvedValue([MOCK_POLICY]);

    const result = await service.listEventPolicies(EVENT_ID, db);

    expect(result).toHaveLength(1);
    expect(result[0].event_id).toBe(EVENT_ID);
  });

  // -------------------------------------------------------------------------
  // 9. getTicketPresenceStatus
  // -------------------------------------------------------------------------

  it('9. getTicketPresenceStatus — returns current presence', async () => {
    const scanHistory: ScanEvent[] = [
      { ...MOCK_SCAN_EVENT, event_type: 'check_in' },
      { ...MOCK_SCAN_EVENT, event_type: 'check_out' },
    ];
    vi.mocked(db.findScanHistory).mockResolvedValue(scanHistory);

    const result = await service.getTicketPresenceStatus(TICKET_ID, EVENT_ID, db);

    expect(result.is_inside).toBe(false);
    expect(result.reentry_count).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 10. Integration: Full flow
  // -------------------------------------------------------------------------

  it('10. Full flow: check-in → exit → re-entry (allowed) → exit → re-entry (limit)', async () => {
    const limitedPolicy = { ...MOCK_POLICY, max_reentries: 1 };

    // Initial check-in
    vi.mocked(db.findScanHistory).mockResolvedValue([]);
    vi.mocked(db.getReentryPolicy).mockResolvedValue(limitedPolicy);
    vi.mocked(db.recordScan).mockResolvedValue(MOCK_SCAN_EVENT);

    let result = await service.processScan(TICKET_ID, TICKET_TYPE_ID, EVENT_ID, GATE_ID, 'entry', STAFF_ID, db);
    expect(result.event_type).toBe('check_in');
    expect(result.allowed).toBe(true);

    // Exit
    const scanHistory1: ScanEvent[] = [
      { ...MOCK_SCAN_EVENT, event_type: 'check_in' },
    ];
    vi.mocked(db.findScanHistory).mockResolvedValue(scanHistory1);
    result = await service.processScan(TICKET_ID, TICKET_TYPE_ID, EVENT_ID, GATE_ID, 'exit', STAFF_ID, db);
    expect(result.event_type).toBe('check_out');
    expect(result.allowed).toBe(true);

    // Re-entry (allowed)
    const scanHistory2: ScanEvent[] = [
      { ...MOCK_SCAN_EVENT, event_type: 'check_in' },
      { ...MOCK_SCAN_EVENT, event_type: 'check_out' },
    ];
    vi.mocked(db.findScanHistory).mockResolvedValue(scanHistory2);
    vi.mocked(db.getTicketTypeInfo).mockResolvedValue({ isVip: false });
    result = await service.processScan(TICKET_ID, TICKET_TYPE_ID, EVENT_ID, GATE_ID, 'entry', STAFF_ID, db);
    expect(result.event_type).toBe('reentry');
    expect(result.reentry_count).toBe(1);
    expect(result.allowed).toBe(true);

    // Exit again
    const scanHistory3: ScanEvent[] = [
      { ...MOCK_SCAN_EVENT, event_type: 'check_in' },
      { ...MOCK_SCAN_EVENT, event_type: 'check_out' },
      { ...MOCK_SCAN_EVENT, event_type: 'check_in' },
      { ...MOCK_SCAN_EVENT, event_type: 'check_out' },
    ];
    vi.mocked(db.findScanHistory).mockResolvedValue(scanHistory3);
    result = await service.processScan(TICKET_ID, TICKET_TYPE_ID, EVENT_ID, GATE_ID, 'exit', STAFF_ID, db);
    expect(result.allowed).toBe(true);

    // Re-entry (limit exceeded)
    const scanHistory4: ScanEvent[] = [
      { ...MOCK_SCAN_EVENT, event_type: 'check_in' },
      { ...MOCK_SCAN_EVENT, event_type: 'check_out' },
      { ...MOCK_SCAN_EVENT, event_type: 'check_in' },
      { ...MOCK_SCAN_EVENT, event_type: 'check_out' },
      { ...MOCK_SCAN_EVENT, event_type: 'check_in' },
      { ...MOCK_SCAN_EVENT, event_type: 'check_out' },
    ];
    vi.mocked(db.findScanHistory).mockResolvedValue(scanHistory4);
    vi.mocked(db.getTicketTypeInfo).mockResolvedValue({ isVip: false });
    result = await service.processScan(TICKET_ID, TICKET_TYPE_ID, EVENT_ID, GATE_ID, 'entry', STAFF_ID, db);
    expect(result.allowed).toBe(false);
    expect(result.reentry_count).toBe(2);
  });
});
