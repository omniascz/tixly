import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  HoldbackService,
  type HoldbackDbAdapter,
  type TicketTypeRow,
} from '../services/holdback.service';
import type {
  InventoryHoldback,
  CreateHoldbackOptions,
} from '../types/holdback.types';
import {
  HoldbackReleaseType,
  HoldbackStatus,
  HoldbackCategory,
  HoldbackNotFoundError,
  UnauthorizedHoldbackError,
  AlreadyReleasedError,
  InvalidHoldbackConfigError,
  InsufficientInventoryError,
  InvalidReleaseQuantityError,
} from '../types/holdback.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG_ID = 'org-1';
const OTHER_ORG_ID = 'org-other';
const EVENT_ID = 'event-1';
const TT_ID = 'tt-1';
const HOLDBACK_ID = 'hb-1';

function makeTicketType(overrides: Partial<TicketTypeRow> = {}): TicketTypeRow {
  return {
    id: TT_ID,
    eventId: EVENT_ID,
    organizerId: ORG_ID,
    totalQty: 1000,
    soldQty: 200,
    remainingQty: 800,
    ...overrides,
  };
}

function makeHoldback(
  overrides: Partial<InventoryHoldback> = {},
): InventoryHoldback {
  return {
    id: HOLDBACK_ID,
    ticketTypeId: TT_ID,
    eventId: EVENT_ID,
    organizerId: ORG_ID,
    name: 'VIP Reserve',
    quantity: 50,
    quantityReleased: 0,
    category: HoldbackCategory.VIP,
    releaseType: HoldbackReleaseType.Manual,
    releaseAt: null,
    releaseTriggerPct: null,
    accessCode: null,
    status: HoldbackStatus.Active,
    notes: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    releasedAt: null,
    releasedBy: null,
    ...overrides,
  };
}

function makeCreateOptions(
  overrides: Partial<CreateHoldbackOptions> = {},
): CreateHoldbackOptions {
  return {
    ticketTypeId: TT_ID,
    eventId: EVENT_ID,
    organizerId: ORG_ID,
    name: 'VIP Reserve',
    quantity: 50,
    category: HoldbackCategory.VIP,
    releaseType: HoldbackReleaseType.Manual,
    ...overrides,
  };
}

function createMockDb(): {
  [K in keyof HoldbackDbAdapter]: ReturnType<typeof vi.fn>;
} {
  return {
    getTicketType: vi.fn(),
    getActiveHoldbackTotal: vi.fn(),
    insertHoldback: vi.fn(),
    decrementRemainingQty: vi.fn(),
    incrementRemainingQty: vi.fn(),
    getHoldback: vi.fn(),
    getHoldbacksByEvent: vi.fn(),
    getActiveHoldbacksByTicketType: vi.fn(),
    updateHoldback: vi.fn(),
    withTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
    findScheduledHoldbacksDue: vi.fn(),
    findTriggerHoldbacks: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HoldbackService', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: HoldbackService;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    service = new HoldbackService(db as unknown as HoldbackDbAdapter);
  });

  // =========================================================================
  // createHoldback
  // =========================================================================

  describe('createHoldback', () => {
    it('creates a manual holdback successfully', async () => {
      const tt = makeTicketType();
      const created = makeHoldback();
      db.getTicketType.mockResolvedValue(tt);
      db.getActiveHoldbackTotal.mockResolvedValue(0);
      db.insertHoldback.mockResolvedValue(created);
      db.decrementRemainingQty.mockResolvedValue(undefined);

      const result = await service.createHoldback(makeCreateOptions());

      expect(result).toEqual(created);
      expect(db.withTransaction).toHaveBeenCalledOnce();
      expect(db.insertHoldback).toHaveBeenCalledOnce();
      expect(db.decrementRemainingQty).toHaveBeenCalledWith(TT_ID, 50);
    });

    it('creates a scheduled holdback when releaseAt is provided', async () => {
      const tt = makeTicketType();
      const created = makeHoldback({
        releaseType: HoldbackReleaseType.Scheduled,
        releaseAt: new Date('2026-06-01'),
      });
      db.getTicketType.mockResolvedValue(tt);
      db.getActiveHoldbackTotal.mockResolvedValue(0);
      db.insertHoldback.mockResolvedValue(created);
      db.decrementRemainingQty.mockResolvedValue(undefined);

      const result = await service.createHoldback(
        makeCreateOptions({
          releaseType: HoldbackReleaseType.Scheduled,
          releaseAt: new Date('2026-06-01'),
        }),
      );

      expect(result.releaseType).toBe(HoldbackReleaseType.Scheduled);
    });

    it('creates a trigger holdback when releaseTriggerPct is provided', async () => {
      const tt = makeTicketType();
      const created = makeHoldback({
        releaseType: HoldbackReleaseType.Trigger,
        releaseTriggerPct: 80,
      });
      db.getTicketType.mockResolvedValue(tt);
      db.getActiveHoldbackTotal.mockResolvedValue(0);
      db.insertHoldback.mockResolvedValue(created);
      db.decrementRemainingQty.mockResolvedValue(undefined);

      const result = await service.createHoldback(
        makeCreateOptions({
          releaseType: HoldbackReleaseType.Trigger,
          releaseTriggerPct: 80,
        }),
      );

      expect(result.releaseTriggerPct).toBe(80);
    });

    it('throws HoldbackNotFoundError when ticket type does not exist', async () => {
      db.getTicketType.mockResolvedValue(null);

      await expect(
        service.createHoldback(makeCreateOptions()),
      ).rejects.toThrow(HoldbackNotFoundError);
    });

    it('throws UnauthorizedHoldbackError when organizer does not own ticket type', async () => {
      db.getTicketType.mockResolvedValue(
        makeTicketType({ organizerId: OTHER_ORG_ID }),
      );

      await expect(
        service.createHoldback(makeCreateOptions()),
      ).rejects.toThrow(UnauthorizedHoldbackError);
    });

    it('throws InsufficientInventoryError when requested qty exceeds available', async () => {
      db.getTicketType.mockResolvedValue(
        makeTicketType({ totalQty: 100, soldQty: 80 }),
      );
      db.getActiveHoldbackTotal.mockResolvedValue(15);

      // available = 100 - 80 - 15 = 5, requesting 50
      await expect(
        service.createHoldback(makeCreateOptions({ quantity: 50 })),
      ).rejects.toThrow(InsufficientInventoryError);
    });

    it('throws InvalidHoldbackConfigError when scheduled type has no releaseAt', async () => {
      await expect(
        service.createHoldback(
          makeCreateOptions({
            releaseType: HoldbackReleaseType.Scheduled,
            // releaseAt intentionally omitted
          }),
        ),
      ).rejects.toThrow(InvalidHoldbackConfigError);
    });

    it('throws InvalidHoldbackConfigError when trigger type has no releaseTriggerPct', async () => {
      await expect(
        service.createHoldback(
          makeCreateOptions({
            releaseType: HoldbackReleaseType.Trigger,
            // releaseTriggerPct intentionally omitted
          }),
        ),
      ).rejects.toThrow(InvalidHoldbackConfigError);
    });

    it('throws InvalidHoldbackConfigError when releaseTriggerPct is 0', async () => {
      await expect(
        service.createHoldback(
          makeCreateOptions({
            releaseType: HoldbackReleaseType.Trigger,
            releaseTriggerPct: 0,
          }),
        ),
      ).rejects.toThrow(InvalidHoldbackConfigError);
    });

    it('throws InvalidHoldbackConfigError when releaseTriggerPct exceeds 100', async () => {
      await expect(
        service.createHoldback(
          makeCreateOptions({
            releaseType: HoldbackReleaseType.Trigger,
            releaseTriggerPct: 101,
          }),
        ),
      ).rejects.toThrow(InvalidHoldbackConfigError);
    });

    it('accounts for existing holdbacks when calculating available inventory', async () => {
      db.getTicketType.mockResolvedValue(
        makeTicketType({ totalQty: 100, soldQty: 0 }),
      );
      db.getActiveHoldbackTotal.mockResolvedValue(90);

      // available = 100 - 0 - 90 = 10, requesting 15
      await expect(
        service.createHoldback(makeCreateOptions({ quantity: 15 })),
      ).rejects.toThrow(InsufficientInventoryError);
    });

    it('validates config before checking DB (early return on config error)', async () => {
      await expect(
        service.createHoldback(
          makeCreateOptions({
            releaseType: HoldbackReleaseType.Scheduled,
          }),
        ),
      ).rejects.toThrow(InvalidHoldbackConfigError);

      // DB should never be called
      expect(db.getTicketType).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // releaseHoldback
  // =========================================================================

  describe('releaseHoldback', () => {
    it('performs full release when no quantity specified', async () => {
      const holdback = makeHoldback({ quantity: 50, quantityReleased: 0 });
      const updated = makeHoldback({
        quantity: 50,
        quantityReleased: 50,
        status: HoldbackStatus.Released,
      });
      db.getHoldback.mockResolvedValue(holdback);
      db.updateHoldback.mockResolvedValue(updated);
      db.incrementRemainingQty.mockResolvedValue(undefined);

      const result = await service.releaseHoldback(HOLDBACK_ID, ORG_ID, {
        releaseToPublic: true,
      });

      expect(result.quantityReleased).toBe(50);
      expect(db.updateHoldback).toHaveBeenCalledWith(
        HOLDBACK_ID,
        expect.objectContaining({
          quantityReleased: 50,
          status: HoldbackStatus.Released,
        }),
      );
      expect(db.incrementRemainingQty).toHaveBeenCalledWith(TT_ID, 50);
    });

    it('performs partial release when quantity is specified', async () => {
      const holdback = makeHoldback({ quantity: 50, quantityReleased: 0 });
      const updated = makeHoldback({ quantity: 50, quantityReleased: 20 });
      db.getHoldback.mockResolvedValue(holdback);
      db.updateHoldback.mockResolvedValue(updated);
      db.incrementRemainingQty.mockResolvedValue(undefined);

      const result = await service.releaseHoldback(HOLDBACK_ID, ORG_ID, {
        quantity: 20,
        releaseToPublic: true,
      });

      expect(result.quantityReleased).toBe(20);
      expect(db.updateHoldback).toHaveBeenCalledWith(
        HOLDBACK_ID,
        expect.objectContaining({
          quantityReleased: 20,
          status: HoldbackStatus.Active, // not fully released
        }),
      );
    });

    it('does not increment remainingQty when releaseToPublic is false', async () => {
      const holdback = makeHoldback({ quantity: 50, quantityReleased: 0 });
      const updated = makeHoldback({
        quantity: 50,
        quantityReleased: 50,
        status: HoldbackStatus.Released,
      });
      db.getHoldback.mockResolvedValue(holdback);
      db.updateHoldback.mockResolvedValue(updated);

      await service.releaseHoldback(HOLDBACK_ID, ORG_ID, {
        releaseToPublic: false,
      });

      expect(db.incrementRemainingQty).not.toHaveBeenCalled();
    });

    it('sets releasedBy when provided', async () => {
      const holdback = makeHoldback({ quantity: 10, quantityReleased: 0 });
      const updated = makeHoldback({
        quantityReleased: 10,
        status: HoldbackStatus.Released,
        releasedBy: 'user-42',
      });
      db.getHoldback.mockResolvedValue(holdback);
      db.updateHoldback.mockResolvedValue(updated);

      await service.releaseHoldback(HOLDBACK_ID, ORG_ID, {
        releaseToPublic: true,
        releasedBy: 'user-42',
      });

      expect(db.updateHoldback).toHaveBeenCalledWith(
        HOLDBACK_ID,
        expect.objectContaining({ releasedBy: 'user-42' }),
      );
    });

    it('throws HoldbackNotFoundError when holdback does not exist', async () => {
      db.getHoldback.mockResolvedValue(null);

      await expect(
        service.releaseHoldback('nonexistent', ORG_ID, {
          releaseToPublic: true,
        }),
      ).rejects.toThrow(HoldbackNotFoundError);
    });

    it('throws UnauthorizedHoldbackError when organizer does not own holdback', async () => {
      db.getHoldback.mockResolvedValue(
        makeHoldback({ organizerId: OTHER_ORG_ID }),
      );

      await expect(
        service.releaseHoldback(HOLDBACK_ID, ORG_ID, {
          releaseToPublic: true,
        }),
      ).rejects.toThrow(UnauthorizedHoldbackError);
    });

    it('throws AlreadyReleasedError when holdback is already released', async () => {
      db.getHoldback.mockResolvedValue(
        makeHoldback({ status: HoldbackStatus.Released }),
      );

      await expect(
        service.releaseHoldback(HOLDBACK_ID, ORG_ID, {
          releaseToPublic: true,
        }),
      ).rejects.toThrow(AlreadyReleasedError);
    });

    it('throws AlreadyReleasedError when holdback is cancelled', async () => {
      db.getHoldback.mockResolvedValue(
        makeHoldback({ status: HoldbackStatus.Cancelled }),
      );

      await expect(
        service.releaseHoldback(HOLDBACK_ID, ORG_ID, {
          releaseToPublic: true,
        }),
      ).rejects.toThrow(AlreadyReleasedError);
    });

    it('throws InvalidReleaseQuantityError when partial qty exceeds held', async () => {
      const holdback = makeHoldback({ quantity: 50, quantityReleased: 40 });
      db.getHoldback.mockResolvedValue(holdback);

      // still held = 50 - 40 = 10, requesting 20
      await expect(
        service.releaseHoldback(HOLDBACK_ID, ORG_ID, {
          quantity: 20,
          releaseToPublic: true,
        }),
      ).rejects.toThrow(InvalidReleaseQuantityError);
    });

    it('marks as fully released when partial release completes remaining qty', async () => {
      const holdback = makeHoldback({ quantity: 50, quantityReleased: 30 });
      const updated = makeHoldback({
        quantityReleased: 50,
        status: HoldbackStatus.Released,
      });
      db.getHoldback.mockResolvedValue(holdback);
      db.updateHoldback.mockResolvedValue(updated);
      db.incrementRemainingQty.mockResolvedValue(undefined);

      await service.releaseHoldback(HOLDBACK_ID, ORG_ID, {
        quantity: 20,
        releaseToPublic: true,
      });

      expect(db.updateHoldback).toHaveBeenCalledWith(
        HOLDBACK_ID,
        expect.objectContaining({
          quantityReleased: 50,
          status: HoldbackStatus.Released,
        }),
      );
    });
  });

  // =========================================================================
  // cancelHoldback
  // =========================================================================

  describe('cancelHoldback', () => {
    it('cancels holdback and restores unreleased qty to public pool', async () => {
      const holdback = makeHoldback({
        quantity: 50,
        quantityReleased: 10,
      });
      db.getHoldback.mockResolvedValue(holdback);
      db.updateHoldback.mockResolvedValue(
        makeHoldback({ status: HoldbackStatus.Cancelled }),
      );
      db.incrementRemainingQty.mockResolvedValue(undefined);

      await service.cancelHoldback(HOLDBACK_ID, ORG_ID);

      expect(db.updateHoldback).toHaveBeenCalledWith(HOLDBACK_ID, {
        status: HoldbackStatus.Cancelled,
      });
      // stillHeld = 50 - 10 = 40
      expect(db.incrementRemainingQty).toHaveBeenCalledWith(TT_ID, 40);
    });

    it('does not increment remaining when all qty was already released', async () => {
      const holdback = makeHoldback({
        quantity: 50,
        quantityReleased: 50,
        status: HoldbackStatus.Active, // edge case: fully released but still active
      });
      db.getHoldback.mockResolvedValue(holdback);
      db.updateHoldback.mockResolvedValue(
        makeHoldback({ status: HoldbackStatus.Cancelled }),
      );

      await service.cancelHoldback(HOLDBACK_ID, ORG_ID);

      expect(db.incrementRemainingQty).not.toHaveBeenCalled();
    });

    it('throws HoldbackNotFoundError when holdback does not exist', async () => {
      db.getHoldback.mockResolvedValue(null);

      await expect(
        service.cancelHoldback('nonexistent', ORG_ID),
      ).rejects.toThrow(HoldbackNotFoundError);
    });

    it('throws UnauthorizedHoldbackError when organizer does not own holdback', async () => {
      db.getHoldback.mockResolvedValue(
        makeHoldback({ organizerId: OTHER_ORG_ID }),
      );

      await expect(
        service.cancelHoldback(HOLDBACK_ID, ORG_ID),
      ).rejects.toThrow(UnauthorizedHoldbackError);
    });

    it('throws AlreadyReleasedError when holdback is already released', async () => {
      db.getHoldback.mockResolvedValue(
        makeHoldback({ status: HoldbackStatus.Released }),
      );

      await expect(
        service.cancelHoldback(HOLDBACK_ID, ORG_ID),
      ).rejects.toThrow(AlreadyReleasedError);
    });

    it('throws AlreadyReleasedError when holdback is already cancelled', async () => {
      db.getHoldback.mockResolvedValue(
        makeHoldback({ status: HoldbackStatus.Cancelled }),
      );

      await expect(
        service.cancelHoldback(HOLDBACK_ID, ORG_ID),
      ).rejects.toThrow(AlreadyReleasedError);
    });
  });

  // =========================================================================
  // getEventHoldbacks
  // =========================================================================

  describe('getEventHoldbacks', () => {
    it('returns aggregated summary for owned holdbacks', async () => {
      const holdbacks: InventoryHoldback[] = [
        makeHoldback({
          id: 'hb-1',
          quantity: 50,
          quantityReleased: 0,
          status: HoldbackStatus.Active,
        }),
        makeHoldback({
          id: 'hb-2',
          quantity: 30,
          quantityReleased: 30,
          status: HoldbackStatus.Released,
        }),
        makeHoldback({
          id: 'hb-3',
          quantity: 20,
          quantityReleased: 5,
          status: HoldbackStatus.Cancelled,
        }),
      ];
      db.getHoldbacksByEvent.mockResolvedValue(holdbacks);

      const result = await service.getEventHoldbacks(EVENT_ID, ORG_ID);

      expect(result.eventId).toBe(EVENT_ID);
      expect(result.totalHoldbackQty).toBe(100); // 50 + 30 + 20
      expect(result.totalReleasedQty).toBe(35); // 0 + 30 + 5
      expect(result.activeCount).toBe(1);
      expect(result.releasedCount).toBe(1);
      expect(result.cancelledCount).toBe(1);
      expect(result.holdbacks).toHaveLength(3);
    });

    it('throws UnauthorizedHoldbackError when holdbacks exist but none belong to organizer', async () => {
      db.getHoldbacksByEvent.mockResolvedValue([
        makeHoldback({ organizerId: OTHER_ORG_ID }),
      ]);

      await expect(
        service.getEventHoldbacks(EVENT_ID, ORG_ID),
      ).rejects.toThrow(UnauthorizedHoldbackError);
    });

    it('returns empty summary when event has no holdbacks', async () => {
      db.getHoldbacksByEvent.mockResolvedValue([]);

      const result = await service.getEventHoldbacks(EVENT_ID, ORG_ID);

      expect(result.totalHoldbackQty).toBe(0);
      expect(result.totalReleasedQty).toBe(0);
      expect(result.activeCount).toBe(0);
      expect(result.releasedCount).toBe(0);
      expect(result.cancelledCount).toBe(0);
      expect(result.holdbacks).toHaveLength(0);
    });

    it('filters out holdbacks belonging to other organizers', async () => {
      db.getHoldbacksByEvent.mockResolvedValue([
        makeHoldback({ id: 'hb-mine', organizerId: ORG_ID, quantity: 50 }),
        makeHoldback({
          id: 'hb-theirs',
          organizerId: OTHER_ORG_ID,
          quantity: 100,
        }),
      ]);

      const result = await service.getEventHoldbacks(EVENT_ID, ORG_ID);

      expect(result.holdbacks).toHaveLength(1);
      expect(result.totalHoldbackQty).toBe(50);
    });
  });

  // =========================================================================
  // validateAccessCode
  // =========================================================================

  describe('validateAccessCode', () => {
    it('returns valid with unlocked ticket count for matching code', async () => {
      db.getActiveHoldbacksByTicketType.mockResolvedValue([
        makeHoldback({
          accessCode: 'VIP2026',
          quantity: 50,
          quantityReleased: 10,
        }),
      ]);

      const result = await service.validateAccessCode(TT_ID, 'VIP2026');

      expect(result.valid).toBe(true);
      expect(result.unlocksTickets).toBe(40); // 50 - 10
    });

    it('returns invalid for wrong code', async () => {
      db.getActiveHoldbacksByTicketType.mockResolvedValue([
        makeHoldback({ accessCode: 'VIP2026' }),
      ]);

      const result = await service.validateAccessCode(TT_ID, 'WRONG');

      expect(result.valid).toBe(false);
      expect(result.unlocksTickets).toBe(0);
    });

    it('returns invalid when no holdbacks exist', async () => {
      db.getActiveHoldbacksByTicketType.mockResolvedValue([]);

      const result = await service.validateAccessCode(TT_ID, 'ANY');

      expect(result.valid).toBe(false);
      expect(result.unlocksTickets).toBe(0);
    });

    it('returns invalid when holdbacks have no access codes', async () => {
      db.getActiveHoldbacksByTicketType.mockResolvedValue([
        makeHoldback({ accessCode: null }),
      ]);

      const result = await service.validateAccessCode(TT_ID, 'VIP2026');

      expect(result.valid).toBe(false);
      expect(result.unlocksTickets).toBe(0);
    });

    it('aggregates tickets from multiple holdbacks with same code', async () => {
      db.getActiveHoldbacksByTicketType.mockResolvedValue([
        makeHoldback({
          id: 'hb-1',
          accessCode: 'SHARED',
          quantity: 30,
          quantityReleased: 5,
        }),
        makeHoldback({
          id: 'hb-2',
          accessCode: 'SHARED',
          quantity: 20,
          quantityReleased: 0,
        }),
        makeHoldback({
          id: 'hb-3',
          accessCode: 'OTHER',
          quantity: 100,
          quantityReleased: 0,
        }),
      ]);

      const result = await service.validateAccessCode(TT_ID, 'SHARED');

      expect(result.valid).toBe(true);
      expect(result.unlocksTickets).toBe(45); // (30-5) + (20-0)
    });

    it('is case-sensitive for access code matching', async () => {
      db.getActiveHoldbacksByTicketType.mockResolvedValue([
        makeHoldback({ accessCode: 'VIP2026' }),
      ]);

      const result = await service.validateAccessCode(TT_ID, 'vip2026');

      expect(result.valid).toBe(false);
    });
  });

  // =========================================================================
  // processScheduledReleases
  // =========================================================================

  describe('processScheduledReleases', () => {
    it('releases scheduled holdbacks that are due', async () => {
      const holdback = makeHoldback({
        id: 'hb-sched',
        releaseType: HoldbackReleaseType.Scheduled,
        releaseAt: new Date('2026-01-01'),
        quantity: 30,
        quantityReleased: 0,
      });
      db.findScheduledHoldbacksDue.mockResolvedValue([holdback]);
      db.findTriggerHoldbacks.mockResolvedValue([]);
      db.getHoldback.mockResolvedValue(holdback);
      db.updateHoldback.mockResolvedValue(
        makeHoldback({
          ...holdback,
          quantityReleased: 30,
          status: HoldbackStatus.Released,
        }),
      );
      db.incrementRemainingQty.mockResolvedValue(undefined);

      const result = await service.processScheduledReleases();

      expect(result.released).toBe(1);
      expect(result.errors).toBe(0);
    });

    it('releases trigger holdbacks when sell-through threshold is met', async () => {
      const holdback = makeHoldback({
        id: 'hb-trig',
        releaseType: HoldbackReleaseType.Trigger,
        releaseTriggerPct: 80,
        quantity: 20,
        quantityReleased: 0,
      });
      const tt = makeTicketType({ totalQty: 100, soldQty: 85 });

      db.findScheduledHoldbacksDue.mockResolvedValue([]);
      db.findTriggerHoldbacks.mockResolvedValue([holdback]);
      db.getTicketType.mockResolvedValue(tt);
      db.getHoldback.mockResolvedValue(holdback);
      db.updateHoldback.mockResolvedValue(
        makeHoldback({
          ...holdback,
          quantityReleased: 20,
          status: HoldbackStatus.Released,
        }),
      );
      db.incrementRemainingQty.mockResolvedValue(undefined);

      const result = await service.processScheduledReleases();

      expect(result.released).toBe(1);
      expect(result.errors).toBe(0);
    });

    it('does not release trigger holdback when threshold not met', async () => {
      const holdback = makeHoldback({
        id: 'hb-trig',
        releaseType: HoldbackReleaseType.Trigger,
        releaseTriggerPct: 80,
      });
      const tt = makeTicketType({ totalQty: 100, soldQty: 50 }); // 50% < 80%

      db.findScheduledHoldbacksDue.mockResolvedValue([]);
      db.findTriggerHoldbacks.mockResolvedValue([holdback]);
      db.getTicketType.mockResolvedValue(tt);

      const result = await service.processScheduledReleases();

      expect(result.released).toBe(0);
      expect(result.errors).toBe(0);
      expect(db.updateHoldback).not.toHaveBeenCalled();
    });

    it('counts errors and continues processing when a release fails', async () => {
      const hb1 = makeHoldback({ id: 'hb-fail', quantity: 10 });
      const hb2 = makeHoldback({ id: 'hb-ok', quantity: 20 });

      db.findScheduledHoldbacksDue.mockResolvedValue([hb1, hb2]);
      db.findTriggerHoldbacks.mockResolvedValue([]);

      // First call fails, second succeeds
      db.getHoldback
        .mockResolvedValueOnce(
          makeHoldback({ id: 'hb-fail', status: HoldbackStatus.Released }),
        )
        .mockResolvedValueOnce(hb2);
      db.updateHoldback.mockResolvedValue(
        makeHoldback({
          id: 'hb-ok',
          quantityReleased: 20,
          status: HoldbackStatus.Released,
        }),
      );
      db.incrementRemainingQty.mockResolvedValue(undefined);

      // Suppress console.error for this test
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const result = await service.processScheduledReleases();

      expect(result.released).toBe(1);
      expect(result.errors).toBe(1);

      consoleSpy.mockRestore();
    });

    it('skips trigger holdback when ticket type is not found', async () => {
      const holdback = makeHoldback({
        releaseType: HoldbackReleaseType.Trigger,
        releaseTriggerPct: 50,
      });

      db.findScheduledHoldbacksDue.mockResolvedValue([]);
      db.findTriggerHoldbacks.mockResolvedValue([holdback]);
      db.getTicketType.mockResolvedValue(null);

      const result = await service.processScheduledReleases();

      expect(result.released).toBe(0);
      expect(result.errors).toBe(0);
    });

    it('returns zeros when no holdbacks are due', async () => {
      db.findScheduledHoldbacksDue.mockResolvedValue([]);
      db.findTriggerHoldbacks.mockResolvedValue([]);

      const result = await service.processScheduledReleases();

      expect(result.released).toBe(0);
      expect(result.errors).toBe(0);
    });

    it('handles mixed scheduled and trigger releases in one run', async () => {
      const scheduled = makeHoldback({
        id: 'hb-sched',
        releaseType: HoldbackReleaseType.Scheduled,
        releaseAt: new Date('2026-01-01'),
        quantity: 10,
      });
      const trigger = makeHoldback({
        id: 'hb-trig',
        releaseType: HoldbackReleaseType.Trigger,
        releaseTriggerPct: 60,
        quantity: 15,
      });
      const tt = makeTicketType({ totalQty: 100, soldQty: 70 }); // 70% >= 60%

      db.findScheduledHoldbacksDue.mockResolvedValue([scheduled]);
      db.findTriggerHoldbacks.mockResolvedValue([trigger]);
      db.getTicketType.mockResolvedValue(tt);

      db.getHoldback
        .mockResolvedValueOnce(scheduled)
        .mockResolvedValueOnce(trigger);

      db.updateHoldback
        .mockResolvedValueOnce(
          makeHoldback({
            ...scheduled,
            quantityReleased: 10,
            status: HoldbackStatus.Released,
          }),
        )
        .mockResolvedValueOnce(
          makeHoldback({
            ...trigger,
            quantityReleased: 15,
            status: HoldbackStatus.Released,
          }),
        );
      db.incrementRemainingQty.mockResolvedValue(undefined);

      const result = await service.processScheduledReleases();

      expect(result.released).toBe(2);
      expect(result.errors).toBe(0);
    });
  });
});
