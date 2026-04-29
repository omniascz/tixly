// ---------------------------------------------------------------------------
// Re-entry Edge Cases — Vitest tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReentryService } from '../services/re-entry.service';
import type { ReentryDbAdapter } from '../services/re-entry.service';
import type { ScanEvent, ReentryPolicy } from '../types/re-entry.types';
import {
  ReentryDeniedError,
  ReentryLimitExceededError,
  ReentryWithoutExitError,
  PolicyNotFoundError,
} from '../types/re-entry.types';

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

const EVENT_ID = 'event-uuid-edge-001';
const TICKET_ID = 'ticket-uuid-edge-001';
const TICKET_TYPE_ID = 'type-uuid-edge-001';
const GATE_ID = 'gate-uuid-edge-001';
const STAFF_ID = 'staff-uuid-edge-001';

const MOCK_SCAN_EVENT: ScanEvent = {
  id: 'scan-uuid-edge-001',
  ticket_id: TICKET_ID,
  gate_id: GATE_ID,
  gate_type: 'entry',
  event_type: 'check_in',
  scanned_at: new Date('2026-04-10T10:00:00Z'),
  staff_id: STAFF_ID,
  allowed: true,
  denial_reason: null,
};

const OPEN_POLICY: ReentryPolicy = {
  id: 'policy-uuid-open',
  event_id: EVENT_ID,
  ticket_type_id: null,
  allowed: true,
  max_reentries: null,
  vip_only: false,
  requires_exit_before_reentry: false,
};

const STRICT_POLICY: ReentryPolicy = {
  id: 'policy-uuid-strict',
  event_id: EVENT_ID,
  ticket_type_id: TICKET_TYPE_ID,
  allowed: true,
  max_reentries: 3,
  vip_only: false,
  requires_exit_before_reentry: true,
};

// ---------------------------------------------------------------------------
// 1. Error classes
// ---------------------------------------------------------------------------

describe('Error classes', () => {
  describe('ReentryDeniedError', () => {
    it('has correct name, code, and message', () => {
      const err = new ReentryDeniedError('not allowed');
      expect(err.name).toBe('ReentryDeniedError');
      expect(err.code).toBe('REENTRY_DENIED');
      expect(err.message).toBe('not allowed');
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('ReentryLimitExceededError', () => {
    it('has correct name, code, current, max, and message', () => {
      const err = new ReentryLimitExceededError(3, 2);
      expect(err.name).toBe('ReentryLimitExceededError');
      expect(err.code).toBe('REENTRY_LIMIT_EXCEEDED');
      expect(err.current).toBe(3);
      expect(err.max).toBe(2);
      expect(err.message).toContain('3');
      expect(err.message).toContain('2');
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('ReentryWithoutExitError', () => {
    it('has correct name, code, and message', () => {
      const err = new ReentryWithoutExitError();
      expect(err.name).toBe('ReentryWithoutExitError');
      expect(err.code).toBe('REENTRY_WITHOUT_EXIT');
      expect(err.message).toContain('exit');
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('PolicyNotFoundError', () => {
    it('has correct name, code, and message containing event id', () => {
      const err = new PolicyNotFoundError('evt-123');
      expect(err.name).toBe('PolicyNotFoundError');
      expect(err.code).toBe('POLICY_NOT_FOUND');
      expect(err.message).toContain('evt-123');
      expect(err).toBeInstanceOf(Error);
    });
  });
});

// ---------------------------------------------------------------------------
// 2-15. ReentryService edge cases
// ---------------------------------------------------------------------------

describe('ReentryService — edge cases', () => {
  let service: ReentryService;
  let db: ReentryDbAdapter;

  beforeEach(() => {
    service = new ReentryService();
    db = makeMockDb();
  });

  // -------------------------------------------------------------------------
  // 2. Bidirectional gate — check_in, check_out, reentry
  // -------------------------------------------------------------------------

  describe('processScan with bidirectional gate', () => {
    it('bidirectional gate + no history → check_in', async () => {
      vi.mocked(db.findScanHistory).mockResolvedValue([]);
      vi.mocked(db.getReentryPolicy).mockResolvedValue(OPEN_POLICY);
      vi.mocked(db.recordScan).mockResolvedValue(MOCK_SCAN_EVENT);

      const result = await service.processScan(
        TICKET_ID, TICKET_TYPE_ID, EVENT_ID, GATE_ID,
        'bidirectional', STAFF_ID, db
      );

      expect(result.allowed).toBe(true);
      expect(result.event_type).toBe('check_in');
      expect(result.reentry_count).toBe(0);
    });

    it('bidirectional gate + currently inside → check_out', async () => {
      const history: ScanEvent[] = [
        { ...MOCK_SCAN_EVENT, id: 'scan-1', event_type: 'check_in' },
      ];
      vi.mocked(db.findScanHistory).mockResolvedValue(history);
      vi.mocked(db.recordScan).mockResolvedValue({
        ...MOCK_SCAN_EVENT,
        event_type: 'check_out',
      });

      const result = await service.processScan(
        TICKET_ID, TICKET_TYPE_ID, EVENT_ID, GATE_ID,
        'bidirectional', STAFF_ID, db
      );

      expect(result.allowed).toBe(true);
      expect(result.event_type).toBe('check_out');
    });

    it('bidirectional gate + exited → reentry', async () => {
      const history: ScanEvent[] = [
        { ...MOCK_SCAN_EVENT, id: 'scan-1', event_type: 'check_in', scanned_at: new Date('2026-04-10T10:00:00Z') },
        { ...MOCK_SCAN_EVENT, id: 'scan-2', event_type: 'check_out', scanned_at: new Date('2026-04-10T11:00:00Z') },
      ];
      vi.mocked(db.findScanHistory).mockResolvedValue(history);
      vi.mocked(db.getReentryPolicy).mockResolvedValue(OPEN_POLICY);
      vi.mocked(db.getTicketTypeInfo).mockResolvedValue({ isVip: false });
      vi.mocked(db.recordScan).mockResolvedValue(MOCK_SCAN_EVENT);

      const result = await service.processScan(
        TICKET_ID, TICKET_TYPE_ID, EVENT_ID, GATE_ID,
        'bidirectional', STAFF_ID, db
      );

      expect(result.allowed).toBe(true);
      expect(result.event_type).toBe('reentry');
      expect(result.reentry_count).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Fallback policy (no specific, no default → open policy)
  // -------------------------------------------------------------------------

  describe('processScan with fallback policy', () => {
    it('uses fallback open policy when no specific and no default exist', async () => {
      const history: ScanEvent[] = [
        { ...MOCK_SCAN_EVENT, id: 'scan-1', event_type: 'check_in', scanned_at: new Date('2026-04-10T10:00:00Z') },
        { ...MOCK_SCAN_EVENT, id: 'scan-2', event_type: 'check_out', scanned_at: new Date('2026-04-10T11:00:00Z') },
      ];
      vi.mocked(db.findScanHistory).mockResolvedValue(history);
      vi.mocked(db.getReentryPolicy).mockResolvedValue(null);
      vi.mocked(db.getDefaultPolicy).mockResolvedValue(null);
      vi.mocked(db.getTicketTypeInfo).mockResolvedValue({ isVip: false });
      vi.mocked(db.recordScan).mockResolvedValue(MOCK_SCAN_EVENT);

      const result = await service.processScan(
        TICKET_ID, TICKET_TYPE_ID, EVENT_ID, GATE_ID,
        'entry', STAFF_ID, db
      );

      expect(result.allowed).toBe(true);
      expect(result.event_type).toBe('reentry');
      expect(result.max_reentries).toBeNull(); // fallback has unlimited
    });
  });

  // -------------------------------------------------------------------------
  // 4. Default policy (no specific but has default)
  // -------------------------------------------------------------------------

  describe('processScan with default policy', () => {
    it('falls back to default policy when specific policy is null', async () => {
      const defaultPolicy: ReentryPolicy = {
        ...OPEN_POLICY,
        id: 'policy-default',
        max_reentries: 5,
      };
      const history: ScanEvent[] = [
        { ...MOCK_SCAN_EVENT, id: 'scan-1', event_type: 'check_in', scanned_at: new Date('2026-04-10T10:00:00Z') },
        { ...MOCK_SCAN_EVENT, id: 'scan-2', event_type: 'check_out', scanned_at: new Date('2026-04-10T11:00:00Z') },
      ];
      vi.mocked(db.findScanHistory).mockResolvedValue(history);
      vi.mocked(db.getReentryPolicy).mockResolvedValue(null);
      vi.mocked(db.getDefaultPolicy).mockResolvedValue(defaultPolicy);
      vi.mocked(db.getTicketTypeInfo).mockResolvedValue({ isVip: false });
      vi.mocked(db.recordScan).mockResolvedValue(MOCK_SCAN_EVENT);

      const result = await service.processScan(
        TICKET_ID, TICKET_TYPE_ID, EVENT_ID, GATE_ID,
        'entry', STAFF_ID, db
      );

      expect(result.allowed).toBe(true);
      expect(result.event_type).toBe('reentry');
      expect(result.max_reentries).toBe(5);
      expect(vi.mocked(db.getDefaultPolicy)).toHaveBeenCalledWith(EVENT_ID);
    });
  });

  // -------------------------------------------------------------------------
  // 5. VIP-only policy with VIP ticket (allowed)
  // -------------------------------------------------------------------------

  describe('processScan — VIP policy', () => {
    it('allows re-entry for VIP ticket when policy is vip_only', async () => {
      const vipPolicy: ReentryPolicy = {
        ...STRICT_POLICY,
        vip_only: true,
      };
      const history: ScanEvent[] = [
        { ...MOCK_SCAN_EVENT, id: 'scan-1', event_type: 'check_in', scanned_at: new Date('2026-04-10T10:00:00Z') },
        { ...MOCK_SCAN_EVENT, id: 'scan-2', event_type: 'check_out', scanned_at: new Date('2026-04-10T11:00:00Z') },
      ];
      vi.mocked(db.findScanHistory).mockResolvedValue(history);
      vi.mocked(db.getReentryPolicy).mockResolvedValue(vipPolicy);
      vi.mocked(db.getTicketTypeInfo).mockResolvedValue({ isVip: true });
      vi.mocked(db.recordScan).mockResolvedValue(MOCK_SCAN_EVENT);

      const result = await service.processScan(
        TICKET_ID, TICKET_TYPE_ID, EVENT_ID, GATE_ID,
        'entry', STAFF_ID, db
      );

      expect(result.allowed).toBe(true);
      expect(result.event_type).toBe('reentry');
      expect(result.reentry_count).toBe(1);
    });

    // -----------------------------------------------------------------------
    // 6. VIP-only policy with non-VIP ticket (denied)
    // -----------------------------------------------------------------------

    it('denies re-entry for non-VIP ticket when policy is vip_only', async () => {
      const vipPolicy: ReentryPolicy = {
        ...STRICT_POLICY,
        vip_only: true,
      };
      const history: ScanEvent[] = [
        { ...MOCK_SCAN_EVENT, id: 'scan-1', event_type: 'check_in', scanned_at: new Date('2026-04-10T10:00:00Z') },
        { ...MOCK_SCAN_EVENT, id: 'scan-2', event_type: 'check_out', scanned_at: new Date('2026-04-10T11:00:00Z') },
      ];
      vi.mocked(db.findScanHistory).mockResolvedValue(history);
      vi.mocked(db.getReentryPolicy).mockResolvedValue(vipPolicy);
      vi.mocked(db.getTicketTypeInfo).mockResolvedValue({ isVip: false });
      vi.mocked(db.recordScan).mockResolvedValue(MOCK_SCAN_EVENT);

      const result = await service.processScan(
        TICKET_ID, TICKET_TYPE_ID, EVENT_ID, GATE_ID,
        'entry', STAFF_ID, db
      );

      expect(result.allowed).toBe(false);
      expect(result.event_type).toBe('reentry');
      expect(result.reason).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 7. Re-entry denied (policy.allowed=false)
  // -------------------------------------------------------------------------

  describe('processScan — re-entry denied by policy', () => {
    it('denies re-entry when policy.allowed is false', async () => {
      const deniedPolicy: ReentryPolicy = {
        ...STRICT_POLICY,
        allowed: false,
      };
      const history: ScanEvent[] = [
        { ...MOCK_SCAN_EVENT, id: 'scan-1', event_type: 'check_in', scanned_at: new Date('2026-04-10T10:00:00Z') },
        { ...MOCK_SCAN_EVENT, id: 'scan-2', event_type: 'check_out', scanned_at: new Date('2026-04-10T11:00:00Z') },
      ];
      vi.mocked(db.findScanHistory).mockResolvedValue(history);
      vi.mocked(db.getReentryPolicy).mockResolvedValue(deniedPolicy);
      vi.mocked(db.getTicketTypeInfo).mockResolvedValue({ isVip: false });
      vi.mocked(db.recordScan).mockResolvedValue(MOCK_SCAN_EVENT);

      const result = await service.processScan(
        TICKET_ID, TICKET_TYPE_ID, EVENT_ID, GATE_ID,
        'entry', STAFF_ID, db
      );

      expect(result.allowed).toBe(false);
      expect(result.event_type).toBe('reentry');
      expect(result.reason).toBeDefined();
      expect(result.max_reentries).toBe(deniedPolicy.max_reentries);
    });
  });

  // -------------------------------------------------------------------------
  // 8. Limit exceeded at exact boundary (count === max)
  // -------------------------------------------------------------------------

  describe('processScan — exact boundary limit', () => {
    it('denies re-entry when reentry_count exactly equals max_reentries', async () => {
      const limitPolicy: ReentryPolicy = {
        ...OPEN_POLICY,
        max_reentries: 2,
        ticket_type_id: TICKET_TYPE_ID,
      };
      // History: check_in, check_out, reentry(1), check_out, reentry(2), check_out
      // presence.reentry_count = 2, which equals max_reentries = 2
      const history: ScanEvent[] = [
        { ...MOCK_SCAN_EVENT, id: 's1', event_type: 'check_in',  scanned_at: new Date('2026-04-10T10:00:00Z') },
        { ...MOCK_SCAN_EVENT, id: 's2', event_type: 'check_out', scanned_at: new Date('2026-04-10T10:30:00Z') },
        { ...MOCK_SCAN_EVENT, id: 's3', event_type: 'check_in',  scanned_at: new Date('2026-04-10T11:00:00Z') },
        { ...MOCK_SCAN_EVENT, id: 's4', event_type: 'check_out', scanned_at: new Date('2026-04-10T11:30:00Z') },
        { ...MOCK_SCAN_EVENT, id: 's5', event_type: 'check_in',  scanned_at: new Date('2026-04-10T12:00:00Z') },
        { ...MOCK_SCAN_EVENT, id: 's6', event_type: 'check_out', scanned_at: new Date('2026-04-10T12:30:00Z') },
      ];
      vi.mocked(db.findScanHistory).mockResolvedValue(history);
      vi.mocked(db.getReentryPolicy).mockResolvedValue(limitPolicy);
      vi.mocked(db.getTicketTypeInfo).mockResolvedValue({ isVip: false });
      vi.mocked(db.recordScan).mockResolvedValue(MOCK_SCAN_EVENT);

      const result = await service.processScan(
        TICKET_ID, TICKET_TYPE_ID, EVENT_ID, GATE_ID,
        'entry', STAFF_ID, db
      );

      expect(result.allowed).toBe(false);
      expect(result.reentry_count).toBe(2);
      expect(result.max_reentries).toBe(2);
    });

    it('allows re-entry when reentry_count is one below max_reentries', async () => {
      const limitPolicy: ReentryPolicy = {
        ...OPEN_POLICY,
        max_reentries: 2,
        ticket_type_id: TICKET_TYPE_ID,
      };
      // History: check_in, check_out, reentry(1), check_out
      // presence.reentry_count = 1, below max_reentries = 2
      const history: ScanEvent[] = [
        { ...MOCK_SCAN_EVENT, id: 's1', event_type: 'check_in',  scanned_at: new Date('2026-04-10T10:00:00Z') },
        { ...MOCK_SCAN_EVENT, id: 's2', event_type: 'check_out', scanned_at: new Date('2026-04-10T10:30:00Z') },
        { ...MOCK_SCAN_EVENT, id: 's3', event_type: 'check_in',  scanned_at: new Date('2026-04-10T11:00:00Z') },
        { ...MOCK_SCAN_EVENT, id: 's4', event_type: 'check_out', scanned_at: new Date('2026-04-10T11:30:00Z') },
      ];
      vi.mocked(db.findScanHistory).mockResolvedValue(history);
      vi.mocked(db.getReentryPolicy).mockResolvedValue(limitPolicy);
      vi.mocked(db.getTicketTypeInfo).mockResolvedValue({ isVip: false });
      vi.mocked(db.recordScan).mockResolvedValue(MOCK_SCAN_EVENT);

      const result = await service.processScan(
        TICKET_ID, TICKET_TYPE_ID, EVENT_ID, GATE_ID,
        'entry', STAFF_ID, db
      );

      expect(result.allowed).toBe(true);
      expect(result.event_type).toBe('reentry');
      expect(result.reentry_count).toBe(2); // incremented: 1 + 1
      expect(result.max_reentries).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // 9. setPolicy — creates new when no existing
  // -------------------------------------------------------------------------

  describe('setPolicy', () => {
    it('creates new policy when no existing policy is found', async () => {
      vi.mocked(db.getReentryPolicy).mockResolvedValue(null);
      vi.mocked(db.createPolicy).mockResolvedValue(STRICT_POLICY);

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

      expect(vi.mocked(db.createPolicy)).toHaveBeenCalledWith(
        expect.objectContaining({
          event_id: EVENT_ID,
          ticket_type_id: TICKET_TYPE_ID,
          allowed: true,
        })
      );
      expect(vi.mocked(db.updatePolicy)).not.toHaveBeenCalled();
      expect(result.id).toBeDefined();
    });

    // -----------------------------------------------------------------------
    // 10. setPolicy — updates existing when found
    // -----------------------------------------------------------------------

    it('updates existing policy when one is found', async () => {
      vi.mocked(db.getReentryPolicy).mockResolvedValue(STRICT_POLICY);
      vi.mocked(db.updatePolicy).mockResolvedValue({
        ...STRICT_POLICY,
        max_reentries: 10,
      });

      const result = await service.setPolicy(
        EVENT_ID,
        'org-uuid',
        {
          ticket_type_id: TICKET_TYPE_ID,
          allowed: true,
          max_reentries: 10,
          vip_only: false,
          requires_exit_before_reentry: true,
        },
        db
      );

      expect(vi.mocked(db.updatePolicy)).toHaveBeenCalledWith(
        STRICT_POLICY.id,
        expect.objectContaining({ max_reentries: 10 })
      );
      expect(vi.mocked(db.createPolicy)).not.toHaveBeenCalled();
      expect(result.max_reentries).toBe(10);
    });

    // -----------------------------------------------------------------------
    // 11. setPolicy — uses getDefaultPolicy for null ticket_type_id
    // -----------------------------------------------------------------------

    it('uses getDefaultPolicy when ticket_type_id is null', async () => {
      vi.mocked(db.getDefaultPolicy).mockResolvedValue(OPEN_POLICY);
      vi.mocked(db.updatePolicy).mockResolvedValue({
        ...OPEN_POLICY,
        max_reentries: 7,
      });

      await service.setPolicy(
        EVENT_ID,
        'org-uuid',
        {
          ticket_type_id: null,
          allowed: true,
          max_reentries: 7,
          vip_only: false,
          requires_exit_before_reentry: false,
        },
        db
      );

      expect(vi.mocked(db.getDefaultPolicy)).toHaveBeenCalledWith(EVENT_ID);
      expect(vi.mocked(db.getReentryPolicy)).not.toHaveBeenCalled();
    });

    it('creates new default policy when getDefaultPolicy returns null', async () => {
      vi.mocked(db.getDefaultPolicy).mockResolvedValue(null);
      vi.mocked(db.createPolicy).mockResolvedValue(OPEN_POLICY);

      await service.setPolicy(
        EVENT_ID,
        'org-uuid',
        {
          ticket_type_id: null,
          allowed: true,
          max_reentries: null,
          vip_only: false,
          requires_exit_before_reentry: false,
        },
        db
      );

      expect(vi.mocked(db.getDefaultPolicy)).toHaveBeenCalledWith(EVENT_ID);
      expect(vi.mocked(db.createPolicy)).toHaveBeenCalledWith(
        expect.objectContaining({
          event_id: EVENT_ID,
          ticket_type_id: null,
        })
      );
    });
  });

  // -------------------------------------------------------------------------
  // 12. getTicketPresenceStatus — empty history
  // -------------------------------------------------------------------------

  describe('getTicketPresenceStatus', () => {
    it('returns zeroed presence for empty scan history', async () => {
      vi.mocked(db.findScanHistory).mockResolvedValue([]);

      const result = await service.getTicketPresenceStatus(TICKET_ID, EVENT_ID, db);

      expect(result.ticket_id).toBe(TICKET_ID);
      expect(result.is_inside).toBe(false);
      expect(result.check_in_count).toBe(0);
      expect(result.check_out_count).toBe(0);
      expect(result.reentry_count).toBe(0);
      expect(result.last_scan_at).toBeNull();
      expect(result.last_event_type).toBeNull();
    });

    it('returns correct presence after multiple scans', async () => {
      const history: ScanEvent[] = [
        { ...MOCK_SCAN_EVENT, id: 's1', event_type: 'check_in',  scanned_at: new Date('2026-04-10T10:00:00Z') },
        { ...MOCK_SCAN_EVENT, id: 's2', event_type: 'check_out', scanned_at: new Date('2026-04-10T10:30:00Z') },
        { ...MOCK_SCAN_EVENT, id: 's3', event_type: 'check_in',  scanned_at: new Date('2026-04-10T11:00:00Z') },
      ];
      vi.mocked(db.findScanHistory).mockResolvedValue(history);

      const result = await service.getTicketPresenceStatus(TICKET_ID, EVENT_ID, db);

      expect(result.is_inside).toBe(true);
      expect(result.check_in_count).toBe(2);
      expect(result.check_out_count).toBe(1);
      expect(result.reentry_count).toBe(1);
      expect(result.last_event_type).toBe('check_in');
    });
  });

  // -------------------------------------------------------------------------
  // 13. Multiple re-entries counting correctly
  // -------------------------------------------------------------------------

  describe('processScan — multiple re-entries counting', () => {
    it('correctly counts after 3 re-entries', async () => {
      // 1 initial check_in + 3 re-entries (each with exit) = check_in_count=4, reentry_count=3
      // Currently outside after last exit
      const history: ScanEvent[] = [
        { ...MOCK_SCAN_EVENT, id: 's1', event_type: 'check_in',  scanned_at: new Date('2026-04-10T10:00:00Z') },
        { ...MOCK_SCAN_EVENT, id: 's2', event_type: 'check_out', scanned_at: new Date('2026-04-10T10:30:00Z') },
        { ...MOCK_SCAN_EVENT, id: 's3', event_type: 'check_in',  scanned_at: new Date('2026-04-10T11:00:00Z') },
        { ...MOCK_SCAN_EVENT, id: 's4', event_type: 'check_out', scanned_at: new Date('2026-04-10T11:30:00Z') },
        { ...MOCK_SCAN_EVENT, id: 's5', event_type: 'check_in',  scanned_at: new Date('2026-04-10T12:00:00Z') },
        { ...MOCK_SCAN_EVENT, id: 's6', event_type: 'check_out', scanned_at: new Date('2026-04-10T12:30:00Z') },
        { ...MOCK_SCAN_EVENT, id: 's7', event_type: 'check_in',  scanned_at: new Date('2026-04-10T13:00:00Z') },
        { ...MOCK_SCAN_EVENT, id: 's8', event_type: 'check_out', scanned_at: new Date('2026-04-10T13:30:00Z') },
      ];
      const unlimitedPolicy: ReentryPolicy = {
        ...OPEN_POLICY,
        max_reentries: null,
        ticket_type_id: TICKET_TYPE_ID,
      };
      vi.mocked(db.findScanHistory).mockResolvedValue(history);
      vi.mocked(db.getReentryPolicy).mockResolvedValue(unlimitedPolicy);
      vi.mocked(db.getTicketTypeInfo).mockResolvedValue({ isVip: false });
      vi.mocked(db.recordScan).mockResolvedValue(MOCK_SCAN_EVENT);

      const result = await service.processScan(
        TICKET_ID, TICKET_TYPE_ID, EVENT_ID, GATE_ID,
        'entry', STAFF_ID, db
      );

      expect(result.allowed).toBe(true);
      expect(result.event_type).toBe('reentry');
      // presence.reentry_count = 3 (4 check_ins - 1), service adds +1
      expect(result.reentry_count).toBe(4);
      expect(result.max_reentries).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 14. Denied scans not counted in presence
  // -------------------------------------------------------------------------

  describe('processScan — denied scans ignored in presence', () => {
    it('denied scans do not affect presence reentry_count', async () => {
      const history: ScanEvent[] = [
        { ...MOCK_SCAN_EVENT, id: 's1', event_type: 'check_in',  allowed: true,  scanned_at: new Date('2026-04-10T10:00:00Z') },
        { ...MOCK_SCAN_EVENT, id: 's2', event_type: 'check_out', allowed: true,  scanned_at: new Date('2026-04-10T10:30:00Z') },
        // A denied re-entry attempt — should NOT count
        { ...MOCK_SCAN_EVENT, id: 's3', event_type: 'check_in',  allowed: false, denial_reason: 'limit exceeded', scanned_at: new Date('2026-04-10T11:00:00Z') },
        // Another denied re-entry attempt
        { ...MOCK_SCAN_EVENT, id: 's4', event_type: 'check_in',  allowed: false, denial_reason: 'vip only', scanned_at: new Date('2026-04-10T11:15:00Z') },
      ];
      vi.mocked(db.findScanHistory).mockResolvedValue(history);
      vi.mocked(db.getReentryPolicy).mockResolvedValue(OPEN_POLICY);
      vi.mocked(db.getTicketTypeInfo).mockResolvedValue({ isVip: false });
      vi.mocked(db.recordScan).mockResolvedValue(MOCK_SCAN_EVENT);

      const result = await service.processScan(
        TICKET_ID, TICKET_TYPE_ID, EVENT_ID, GATE_ID,
        'entry', STAFF_ID, db
      );

      // Only 1 allowed check_in + 1 check_out → reentry_count = 0
      // This is a re-entry (has been inside before), so service returns 0 + 1 = 1
      expect(result.allowed).toBe(true);
      expect(result.event_type).toBe('reentry');
      expect(result.reentry_count).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 15. processScan records denied scan with correct reason
  // -------------------------------------------------------------------------

  describe('processScan — denied scan recording', () => {
    it('records denied scan with denial_reason when policy disallows re-entry', async () => {
      const deniedPolicy: ReentryPolicy = {
        ...STRICT_POLICY,
        allowed: false,
      };
      const history: ScanEvent[] = [
        { ...MOCK_SCAN_EVENT, id: 's1', event_type: 'check_in', scanned_at: new Date('2026-04-10T10:00:00Z') },
        { ...MOCK_SCAN_EVENT, id: 's2', event_type: 'check_out', scanned_at: new Date('2026-04-10T11:00:00Z') },
      ];
      vi.mocked(db.findScanHistory).mockResolvedValue(history);
      vi.mocked(db.getReentryPolicy).mockResolvedValue(deniedPolicy);
      vi.mocked(db.getTicketTypeInfo).mockResolvedValue({ isVip: false });
      vi.mocked(db.recordScan).mockResolvedValue(MOCK_SCAN_EVENT);

      await service.processScan(
        TICKET_ID, TICKET_TYPE_ID, EVENT_ID, GATE_ID,
        'entry', STAFF_ID, db
      );

      expect(vi.mocked(db.recordScan)).toHaveBeenCalledWith(
        expect.objectContaining({
          ticket_id: TICKET_ID,
          allowed: false,
          denial_reason: expect.any(String),
        })
      );
      // Verify the denial reason is non-empty
      const callArgs = vi.mocked(db.recordScan).mock.calls[0][0];
      expect(callArgs.denial_reason).toBeTruthy();
      expect(callArgs.denial_reason!.length).toBeGreaterThan(0);
    });

    it('records denied scan for limit exceeded with correct fields', async () => {
      const limitPolicy: ReentryPolicy = {
        ...OPEN_POLICY,
        max_reentries: 1,
        ticket_type_id: TICKET_TYPE_ID,
      };
      const history: ScanEvent[] = [
        { ...MOCK_SCAN_EVENT, id: 's1', event_type: 'check_in',  scanned_at: new Date('2026-04-10T10:00:00Z') },
        { ...MOCK_SCAN_EVENT, id: 's2', event_type: 'check_out', scanned_at: new Date('2026-04-10T10:30:00Z') },
        { ...MOCK_SCAN_EVENT, id: 's3', event_type: 'check_in',  scanned_at: new Date('2026-04-10T11:00:00Z') },
        { ...MOCK_SCAN_EVENT, id: 's4', event_type: 'check_out', scanned_at: new Date('2026-04-10T11:30:00Z') },
      ];
      vi.mocked(db.findScanHistory).mockResolvedValue(history);
      vi.mocked(db.getReentryPolicy).mockResolvedValue(limitPolicy);
      vi.mocked(db.getTicketTypeInfo).mockResolvedValue({ isVip: false });
      vi.mocked(db.recordScan).mockResolvedValue(MOCK_SCAN_EVENT);

      const result = await service.processScan(
        TICKET_ID, TICKET_TYPE_ID, EVENT_ID, GATE_ID,
        'entry', STAFF_ID, db
      );

      expect(result.allowed).toBe(false);
      expect(vi.mocked(db.recordScan)).toHaveBeenCalledWith(
        expect.objectContaining({
          allowed: false,
          event_type: 'check_in',
          gate_type: 'entry',
        })
      );
    });

    it('records denied scan for re-entry without exit', async () => {
      const exitRequiredPolicy: ReentryPolicy = {
        ...STRICT_POLICY,
        requires_exit_before_reentry: true,
      };
      // Currently inside (no exit after check_in)
      const history: ScanEvent[] = [
        { ...MOCK_SCAN_EVENT, id: 's1', event_type: 'check_in', scanned_at: new Date('2026-04-10T10:00:00Z') },
      ];
      vi.mocked(db.findScanHistory).mockResolvedValue(history);
      vi.mocked(db.getReentryPolicy).mockResolvedValue(exitRequiredPolicy);
      vi.mocked(db.getTicketTypeInfo).mockResolvedValue({ isVip: false });
      vi.mocked(db.recordScan).mockResolvedValue(MOCK_SCAN_EVENT);

      const result = await service.processScan(
        TICKET_ID, TICKET_TYPE_ID, EVENT_ID, GATE_ID,
        'entry', STAFF_ID, db
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
      expect(vi.mocked(db.recordScan)).toHaveBeenCalledWith(
        expect.objectContaining({
          allowed: false,
          denial_reason: expect.any(String),
        })
      );
    });
  });
});
