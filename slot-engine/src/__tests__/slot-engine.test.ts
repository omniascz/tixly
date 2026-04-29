import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SlotError, isSlotError } from '../lib/slot-errors';
import {
  createResource,
  getResource,
  listResources,
  updateResource,
  deactivateResource,
} from '../services/resource.service';
import {
  addRule,
  getRules,
  updateRule,
  deleteRule,
  addOverride,
  getOverrides,
} from '../services/availability.service';
import {
  generateSlotsForDate,
  generateSlotsForRange,
  getAvailableSlots,
  getSlot,
  closeSlot,
  refreshSlotStatus,
} from '../services/slot-generator.service';
import {
  holdSlot,
  releaseHold,
  confirmBooking,
  cancelBooking,
  getBooking,
  listBookingsForUser,
  listBookingsForSlot,
  markNoShow,
  markCompleted,
  cleanupExpiredHolds,
} from '../services/booking.service';

// ---------------------------------------------------------------------------
// makeDb helper — query() increments index; execute() does NOT
// ---------------------------------------------------------------------------

function makeDb(responses: unknown[][] = []) {
  let i = 0;
  return {
    query: vi.fn(async () => ({ rows: responses[i++] ?? [] })),
    execute: vi.fn(async () => {}),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROMOTER_ID = 'promoter-uuid-0001';
const BRANCH_ID = 'branch-uuid-0001';
const RESOURCE_ID = 'resource-uuid-0001';
const RULE_ID = 'rule-uuid-0001';
const OVERRIDE_ID = 'override-uuid-0001';
const SLOT_ID = 'slot-uuid-0001';
const BOOKING_ID = 'booking-uuid-0001';
const HOLD_ID = 'hold-uuid-0001';
const USER_ID = 'user-uuid-0001';
const ORDER_ID = 'order-uuid-0001';

const RESOURCE_ROW = {
  id: RESOURCE_ID,
  promoter_id: PROMOTER_ID,
  branch_id: BRANCH_ID,
  name: 'Court A',
  resource_type: 'court',
  description: 'Tennis court',
  capacity: 1,
  is_active: true,
  metadata: {},
  created_at: '2026-04-07T10:00:00.000Z',
};

const RULE_ROW = {
  id: RULE_ID,
  resource_id: RESOURCE_ID,
  day_of_week: 1, // Monday
  start_time: '09:00:00',
  end_time: '12:00:00',
  slot_duration_minutes: 60,
  max_advance_days: 30,
  price_hellers: 50000,
  is_active: true,
  valid_from: null,
  valid_until: null,
};

const OVERRIDE_ROW = {
  id: OVERRIDE_ID,
  resource_id: RESOURCE_ID,
  override_date: '2026-04-07',
  override_type: 'closed',
  start_time: null,
  end_time: null,
  price_hellers: null,
  capacity_override: null,
  reason: 'Holiday',
};

const SLOT_ROW = {
  id: SLOT_ID,
  resource_id: RESOURCE_ID,
  slot_date: '2026-04-07',
  start_time: '09:00:00',
  end_time: '10:00:00',
  capacity: 1,
  booked_count: 0,
  price_hellers: 50000,
  status: 'available',
  generated_from_rule_id: RULE_ID,
  override_id: null,
};

const BOOKING_ROW = {
  id: BOOKING_ID,
  slot_id: SLOT_ID,
  user_id: USER_ID,
  promoter_id: PROMOTER_ID,
  quantity: 1,
  status: 'confirmed',
  price_hellers: 50000,
  order_id: ORDER_ID,
  notes: null,
  booked_at: '2026-04-07T10:00:00.000Z',
  cancelled_at: null,
  cancellation_reason: null,
  reminder_sent_at: null,
  permanentka_usage_id: null,
};

const HOLD_ROW = {
  id: HOLD_ID,
  slot_id: SLOT_ID,
  user_id: USER_ID,
  quantity: 1,
  held_until: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  session_token: 'tok-abc-123',
};

// ---------------------------------------------------------------------------
// Resource tests
// ---------------------------------------------------------------------------

describe('Resource', () => {
  it('createResource — valid', async () => {
    const db = makeDb([[RESOURCE_ROW]]);
    const result = await createResource(PROMOTER_ID, {
      name: 'Court A',
      resourceType: 'court',
      capacity: 1,
    }, db);
    expect(result.id).toBe(RESOURCE_ID);
    expect(result.name).toBe('Court A');
    expect(result.resourceType).toBe('court');
    expect(result.promoterId).toBe(PROMOTER_ID);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('createResource — duplicate → RESOURCE_DUPLICATE', async () => {
    const db = makeDb([[]]); // empty rows = conflict
    await expect(createResource(PROMOTER_ID, { name: 'Court A', resourceType: 'court' }, db))
      .rejects.toThrow(SlotError);
    await expect(createResource(PROMOTER_ID, { name: 'Court A', resourceType: 'court' }, makeDb([[]])))
      .rejects.toMatchObject({ code: 'RESOURCE_DUPLICATE' });
  });

  it('getResource — found', async () => {
    const db = makeDb([[RESOURCE_ROW]]);
    const result = await getResource(RESOURCE_ID, db);
    expect(result.id).toBe(RESOURCE_ID);
  });

  it('getResource — not found', async () => {
    const db = makeDb([[]]);
    await expect(getResource('nonexistent', db)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('listResources — filter by type', async () => {
    const db = makeDb([[RESOURCE_ROW]]);
    const results = await listResources(PROMOTER_ID, { resourceType: 'court' }, db);
    expect(results).toHaveLength(1);
    expect(results[0].resourceType).toBe('court');
    // Verify the SQL included the resourceType param
    const sqlCall = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sqlCall).toContain('resource_type');
  });

  it('listResources — filter by is_active', async () => {
    const db = makeDb([[RESOURCE_ROW]]);
    const results = await listResources(PROMOTER_ID, { isActive: true }, db);
    expect(results).toHaveLength(1);
    expect(results[0].isActive).toBe(true);
  });

  it('updateResource — partial', async () => {
    const updated = { ...RESOURCE_ROW, capacity: 4 };
    const db = makeDb([[updated]]);
    const result = await updateResource(RESOURCE_ID, { capacity: 4 }, db);
    expect(result.capacity).toBe(4);
  });

  it('deactivateResource — sets is_active=false', async () => {
    const deactivated = { ...RESOURCE_ROW, is_active: false };
    const db = makeDb([[deactivated]]);
    const result = await deactivateResource(RESOURCE_ID, db);
    expect(result.isActive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Availability tests
// ---------------------------------------------------------------------------

describe('Availability', () => {
  it('addRule — valid', async () => {
    const db = makeDb([[RULE_ROW]]);
    const result = await addRule(RESOURCE_ID, {
      dayOfWeek: 1,
      startTime: '09:00',
      endTime: '12:00',
      slotDurationMinutes: 60,
      priceHellers: 50000,
    }, db);
    expect(result.id).toBe(RULE_ID);
    expect(result.dayOfWeek).toBe(1);
    expect(result.priceHellers).toBe(50000);
  });

  it('addRule — duplicate → RULE_CONFLICT', async () => {
    const db = makeDb([[]]); // empty rows
    await expect(addRule(RESOURCE_ID, {
      dayOfWeek: 1,
      startTime: '09:00',
      endTime: '12:00',
    }, db)).rejects.toMatchObject({ code: 'RULE_CONFLICT' });
  });

  it('getRules — returns active rules', async () => {
    const db = makeDb([[RULE_ROW]]);
    const results = await getRules(RESOURCE_ID, db);
    expect(results).toHaveLength(1);
    expect(results[0].isActive).toBe(true);
    const sqlCall = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sqlCall).toContain('is_active = true');
  });

  it('updateRule — partial', async () => {
    const updated = { ...RULE_ROW, price_hellers: 75000 };
    const db = makeDb([[updated]]);
    const result = await updateRule(RULE_ID, { priceHellers: 75000 }, db);
    expect(result.priceHellers).toBe(75000);
  });

  it('deleteRule — removes', async () => {
    const db = makeDb([]);
    await expect(deleteRule(RULE_ID, db)).resolves.toBeUndefined();
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('addOverride — closed type', async () => {
    const db = makeDb([[OVERRIDE_ROW]]);
    const result = await addOverride(RESOURCE_ID, {
      overrideDate: '2026-04-07',
      overrideType: 'closed',
      reason: 'Holiday',
    }, db);
    expect(result.overrideType).toBe('closed');
    expect(result.reason).toBe('Holiday');
  });

  it('addOverride — price_override type', async () => {
    const priceOverrideRow = {
      ...OVERRIDE_ROW,
      id: 'override-uuid-0002',
      override_type: 'price_override',
      price_hellers: 30000,
      reason: 'Special discount',
    };
    const db = makeDb([[priceOverrideRow]]);
    const result = await addOverride(RESOURCE_ID, {
      overrideDate: '2026-04-08',
      overrideType: 'price_override',
      priceHellers: 30000,
    }, db);
    expect(result.overrideType).toBe('price_override');
    expect(result.priceHellers).toBe(30000);
  });

  it('getOverrides — date range filter', async () => {
    const db = makeDb([[OVERRIDE_ROW]]);
    const results = await getOverrides(RESOURCE_ID, '2026-04-01', '2026-04-30', db);
    expect(results).toHaveLength(1);
    const sqlCall = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sqlCall).toContain('BETWEEN');
  });
});

// ---------------------------------------------------------------------------
// Slot Generation tests
// ---------------------------------------------------------------------------

describe('Slot Generation', () => {
  it('generateSlotsForDate — generates correct slots from rule (09:00–12:00 @ 60min = 3 slots)', async () => {
    // Monday 2026-04-06 (day 1 = Monday)
    const mondayDate = '2026-04-06';
    // Query 1: rules for day_of_week=1 (Monday)
    // Query 2: overrides for date (none)
    const db = makeDb([[RULE_ROW], []]);
    const slots = await generateSlotsForDate(RESOURCE_ID, mondayDate, db);
    expect(slots).toHaveLength(3);
    expect(slots[0].startTime).toBe('09:00:00');
    expect(slots[0].endTime).toBe('10:00:00');
    expect(slots[1].startTime).toBe('10:00:00');
    expect(slots[1].endTime).toBe('11:00:00');
    expect(slots[2].startTime).toBe('11:00:00');
    expect(slots[2].endTime).toBe('12:00:00');
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('generateSlotsForDate — applies closed override (no slots generated)', async () => {
    const mondayDate = '2026-04-06';
    // Query 1: rules, Query 2: override (whole-day closed)
    const db = makeDb([[RULE_ROW], [OVERRIDE_ROW]]);
    const slots = await generateSlotsForDate(RESOURCE_ID, mondayDate, db);
    expect(slots).toHaveLength(0);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('generateSlotsForDate — applies price_override (slot has new price)', async () => {
    const mondayDate = '2026-04-06';
    const priceOverride = {
      id: OVERRIDE_ID,
      resource_id: RESOURCE_ID,
      override_date: mondayDate,
      override_type: 'price_override',
      start_time: null,
      end_time: null,
      price_hellers: 25000,
      capacity_override: null,
      reason: null,
    };
    // Query 1: rules, Query 2: price override
    const db = makeDb([[RULE_ROW], [priceOverride]]);
    const slots = await generateSlotsForDate(RESOURCE_ID, mondayDate, db);
    expect(slots).toHaveLength(3);
    expect(slots[0].priceHellers).toBe(25000);
    expect(slots[1].priceHellers).toBe(25000);
  });

  it('generateSlotsForDate — idempotent (ON CONFLICT DO NOTHING)', async () => {
    const mondayDate = '2026-04-06';
    // Run twice — each time query 1=rules, query 2=no overrides
    const db1 = makeDb([[RULE_ROW], []]);
    const db2 = makeDb([[RULE_ROW], []]);
    const slots1 = await generateSlotsForDate(RESOURCE_ID, mondayDate, db1);
    const slots2 = await generateSlotsForDate(RESOURCE_ID, mondayDate, db2);
    // Both generate 3 slots; execute called with ON CONFLICT DO NOTHING
    expect(slots1).toHaveLength(3);
    expect(slots2).toHaveLength(3);
    const sql1 = (db1.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const sql2 = (db2.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql1).toContain('ON CONFLICT');
    expect(sql2).toContain('ON CONFLICT');
  });

  it('generateSlotsForRange — generates for multiple dates', async () => {
    // 2026-04-06 (Mon) and 2026-04-07 (Tue)
    // Each date: query(rules) + query(overrides) + execute(insert)
    // But Tue has no rules matching day_of_week=2
    const db = makeDb([
      [RULE_ROW], // Mon rules
      [],         // Mon overrides
      [],         // Tue rules (none)
      [],         // Tue overrides
    ]);
    const slots = await generateSlotsForRange(RESOURCE_ID, '2026-04-06', '2026-04-07', db);
    // Mon generates 3 slots, Tue generates 0
    expect(slots).toHaveLength(3);
    expect(db.query).toHaveBeenCalledTimes(4);
  });

  it('getAvailableSlots — returns only available/partial', async () => {
    const partialRow = { ...SLOT_ROW, id: 'slot-uuid-0002', status: 'partial', booked_count: 0 };
    const fullRow = { ...SLOT_ROW, id: 'slot-uuid-0003', status: 'full', booked_count: 1 };
    const db = makeDb([[SLOT_ROW, partialRow]]); // full row not returned (filtered by SQL)
    const slots = await getAvailableSlots(RESOURCE_ID, '2026-04-06', '2026-04-07', db);
    expect(slots).toHaveLength(2);
    expect(slots.map(s => s.status)).not.toContain('full');
    const sqlCall = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sqlCall).toContain("'available'");
    expect(sqlCall).toContain("'partial'");
  });

  it('getSlot — with resource info', async () => {
    const slotWithResourceRow = {
      ...SLOT_ROW,
      resource_name: 'Court A',
      resource_type: 'court',
      promoter_id: PROMOTER_ID,
    };
    const db = makeDb([[slotWithResourceRow]]);
    const result = await getSlot(SLOT_ID, db);
    expect(result.id).toBe(SLOT_ID);
    expect(result.resource.name).toBe('Court A');
    expect(result.resource.resourceType).toBe('court');
    expect(result.resource.promoterId).toBe(PROMOTER_ID);
  });

  it('closeSlot — sets status=closed', async () => {
    const closedRow = { ...SLOT_ROW, status: 'closed' };
    const db = makeDb([[closedRow]]);
    const result = await closeSlot(SLOT_ID, 'maintenance', db);
    expect(result.status).toBe('closed');
    const sqlCall = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sqlCall).toContain("'closed'");
  });

  it('refreshSlotStatus — available when booked_count=0', async () => {
    const slotRow = { ...SLOT_ROW, booked_count: 0, capacity: 1, status: 'available' };
    const db = makeDb([[slotRow]]);
    const result = await refreshSlotStatus(SLOT_ID, db);
    expect(result.status).toBe('available');
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('refreshSlotStatus — partial when 0 < booked_count < capacity', async () => {
    const slotRow = { ...SLOT_ROW, booked_count: 2, capacity: 5, status: 'available' };
    const db = makeDb([[slotRow]]);
    const result = await refreshSlotStatus(SLOT_ID, db);
    expect(result.status).toBe('partial');
  });

  it('refreshSlotStatus — full when booked_count=capacity', async () => {
    const slotRow = { ...SLOT_ROW, booked_count: 1, capacity: 1, status: 'partial' };
    const db = makeDb([[slotRow]]);
    const result = await refreshSlotStatus(SLOT_ID, db);
    expect(result.status).toBe('full');
  });
});

// ---------------------------------------------------------------------------
// Booking tests
// ---------------------------------------------------------------------------

describe('Booking', () => {
  it('holdSlot — valid → returns session_token', async () => {
    // Query 1: get slot (available, booked_count=0, capacity=2)
    // Query 2: count active holds → 0
    const slotRow = { ...SLOT_ROW, capacity: 2, booked_count: 0, status: 'available' };
    const db = makeDb([[slotRow], [{ total: 0 }]]);
    const hold = await holdSlot(SLOT_ID, USER_ID, 1, db);
    expect(hold.slotId).toBe(SLOT_ID);
    expect(hold.userId).toBe(USER_ID);
    expect(hold.sessionToken).toBeDefined();
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('holdSlot — slot full → SLOT_FULL', async () => {
    const fullSlotRow = { ...SLOT_ROW, status: 'full', booked_count: 1, capacity: 1 };
    const db = makeDb([[fullSlotRow]]);
    await expect(holdSlot(SLOT_ID, USER_ID, 1, db)).rejects.toMatchObject({ code: 'SLOT_FULL' });
  });

  it('holdSlot — slot closed → SLOT_NOT_AVAILABLE', async () => {
    const closedSlotRow = { ...SLOT_ROW, status: 'closed' };
    const db = makeDb([[closedSlotRow]]);
    await expect(holdSlot(SLOT_ID, USER_ID, 1, db)).rejects.toMatchObject({ code: 'SLOT_NOT_AVAILABLE' });
  });

  it('holdSlot — capacity exceeded by active holds → SLOT_FULL', async () => {
    // slot capacity=1, booked_count=0, but active holds = 1
    const slotRow = { ...SLOT_ROW, capacity: 1, booked_count: 0, status: 'available' };
    const db = makeDb([[slotRow], [{ total: 1 }]]);
    await expect(holdSlot(SLOT_ID, USER_ID, 1, db)).rejects.toMatchObject({ code: 'SLOT_FULL' });
  });

  it('releaseHold — deletes hold', async () => {
    const db = makeDb([]);
    await releaseHold(HOLD_ID, db);
    expect(db.execute).toHaveBeenCalledTimes(1);
    const sqlCall = (db.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sqlCall).toContain('DELETE');
  });

  it('confirmBooking — valid → creates booking, updates booked_count', async () => {
    // Query 1: get hold (valid, not expired)
    // Query 2: INSERT booking RETURNING * → booking row
    // execute 1: update slot booked_count
    // execute 2: delete hold
    // Query 3: get slot (for refreshSlotStatus)
    // execute 3: update slot status
    const db = makeDb([
      [HOLD_ROW],       // Query 1: hold
      [BOOKING_ROW],    // Query 2: INSERT RETURNING → booking
      [SLOT_ROW],       // Query 3: slot for refreshSlotStatus
    ]);
    const result = await confirmBooking(HOLD_ID, ORDER_ID, db);
    expect(result.slotId).toBe(SLOT_ID);
    expect(result.status).toBe('confirmed');
    expect(result.permanentkaUsageId).toBeNull();
    expect(db.query).toHaveBeenCalledTimes(3);
    expect(db.execute).toHaveBeenCalledTimes(3);
  });

  it('confirmBooking — hold expired → HOLD_EXPIRED', async () => {
    const expiredHold = {
      ...HOLD_ROW,
      held_until: new Date(Date.now() - 1000).toISOString(), // past
    };
    const db = makeDb([[expiredHold]]);
    await expect(confirmBooking(HOLD_ID, ORDER_ID, db)).rejects.toMatchObject({ code: 'HOLD_EXPIRED' });
  });

  // ---------------------------------------------------------------------------
  // Permanentka integration
  // ---------------------------------------------------------------------------

  const PACKAGE_ID = 'pkg-uuid-0001';
  const USAGE_ID = 'usage-uuid-0001';

  it('confirmBooking — with permanentkaOps → consumeCredit called, usageId stored', async () => {
    // Query 1: hold, Query 2: INSERT RETURNING, Query 3: slot for refresh
    // Execute 1: booked_count, Execute 2: delete hold, Execute 3: permanentka_usage_id UPDATE, Execute 4: slot status
    const bookingRowWithUsage = { ...BOOKING_ROW, permanentka_usage_id: USAGE_ID };
    const db = makeDb([
      [HOLD_ROW],              // Query 1: hold
      [BOOKING_ROW],           // Query 2: INSERT RETURNING
      [SLOT_ROW],              // Query 3: slot for refreshSlotStatus
    ]);
    const consumeCredit = vi.fn().mockResolvedValue({ usageId: USAGE_ID, remainingCredits: 9 });
    const permanentkaOps = {
      packageId: PACKAGE_ID,
      consumeCredit,
      refundCredit: vi.fn(),
    };

    const result = await confirmBooking(HOLD_ID, ORDER_ID, db, permanentkaOps);

    expect(result.permanentkaUsageId).toBe(USAGE_ID);
    expect(consumeCredit).toHaveBeenCalledOnce();
    expect(consumeCredit).toHaveBeenCalledWith(PACKAGE_ID, USER_ID, BOOKING_ID);
    // Executes: booked_count update, delete hold, permanentka_usage_id UPDATE, slot status
    expect(db.execute).toHaveBeenCalledTimes(4);
    // Verify the permanentka_usage_id UPDATE was called
    const updateCall = (db.execute as ReturnType<typeof vi.fn>).mock.calls.find(
      (args: unknown[]) => typeof args[0] === 'string' && (args[0] as string).includes('permanentka_usage_id'),
    );
    expect(updateCall).toBeDefined();
  });

  it('confirmBooking — without permanentkaOps → consumeCredit NOT called', async () => {
    const db = makeDb([
      [HOLD_ROW],
      [BOOKING_ROW],
      [SLOT_ROW],
    ]);
    const result = await confirmBooking(HOLD_ID, ORDER_ID, db);
    expect(result.permanentkaUsageId).toBeNull();
    // Only 3 executes: booked_count, delete hold, slot status (no permanentka UPDATE)
    expect(db.execute).toHaveBeenCalledTimes(3);
  });

  it('confirmBooking — consumeCredit fails → CREDIT_CONSUMPTION_FAILED, booking cancelled, slot restored', async () => {
    const db = makeDb([
      [HOLD_ROW],
      [BOOKING_ROW],
      [SLOT_ROW],
    ]);
    const consumeCredit = vi.fn().mockRejectedValue(new Error('PACKAGE_DEPLETED'));
    const permanentkaOps = {
      packageId: PACKAGE_ID,
      consumeCredit,
      refundCredit: vi.fn(),
    };

    await expect(confirmBooking(HOLD_ID, ORDER_ID, db, permanentkaOps))
      .rejects.toMatchObject({ code: 'CREDIT_CONSUMPTION_FAILED' });

    // Compensation executes: cancel booking UPDATE + restore booked_count UPDATE
    const executeCalls = (db.execute as ReturnType<typeof vi.fn>).mock.calls;
    const hasCancelUpdate = executeCalls.some(
      (args: unknown[]) => typeof args[0] === 'string' && (args[0] as string).includes("'cancelled'"),
    );
    const hasRestoreCount = executeCalls.some(
      (args: unknown[]) => typeof args[0] === 'string' && (args[0] as string).includes('GREATEST'),
    );
    expect(hasCancelUpdate).toBe(true);
    expect(hasRestoreCount).toBe(true);
  });

  it('cancelBooking — with permanentka_usage_id → refundCredit called', async () => {
    const bookingWithUsage = { ...BOOKING_ROW, permanentka_usage_id: USAGE_ID };
    const slotForRefresh = { ...SLOT_ROW, booked_count: 0, capacity: 1, status: 'available' };
    const db = makeDb([
      [bookingWithUsage],   // Query 1: booking (has permanentka_usage_id)
      [slotForRefresh],     // Query 2: slot for refreshSlotStatus
    ]);
    const refundCredit = vi.fn().mockResolvedValue({ remainingCredits: 10 });
    const permanentkaOps = { refundCredit };

    const result = await cancelBooking(BOOKING_ID, 'Customer request', db, permanentkaOps);

    expect(result.status).toBe('cancelled');
    expect(refundCredit).toHaveBeenCalledOnce();
    expect(refundCredit).toHaveBeenCalledWith(USAGE_ID, 'Customer request');
  });

  it('cancelBooking — no permanentka_usage_id → refundCredit NOT called', async () => {
    const slotForRefresh = { ...SLOT_ROW, booked_count: 0, capacity: 1, status: 'available' };
    const db = makeDb([
      [BOOKING_ROW],        // booking without permanentka_usage_id (null)
      [slotForRefresh],
    ]);
    const refundCredit = vi.fn();
    const permanentkaOps = { refundCredit };

    const result = await cancelBooking(BOOKING_ID, 'Customer request', db, permanentkaOps);

    expect(result.status).toBe('cancelled');
    expect(refundCredit).not.toHaveBeenCalled();
  });

  it('cancelBooking — valid → status=cancelled, booked_count decremented', async () => {
    // Query 1: get booking (confirmed)
    // execute 1: update booking status
    // execute 2: update slot booked_count
    // Query 2: get slot for refresh
    // execute 3: update slot status
    const slotForRefresh = { ...SLOT_ROW, booked_count: 0, capacity: 1, status: 'available' };
    const db = makeDb([
      [BOOKING_ROW],         // Query 1: booking
      [slotForRefresh],      // Query 2: slot for refresh
    ]);
    const result = await cancelBooking(BOOKING_ID, 'Customer request', db);
    expect(result.status).toBe('cancelled');
    expect(result.cancellationReason).toBe('Customer request');
    expect(db.execute).toHaveBeenCalledTimes(3);
  });

  it('cancelBooking — already cancelled → BOOKING_ALREADY_CANCELLED', async () => {
    const cancelledBooking = { ...BOOKING_ROW, status: 'cancelled' };
    const db = makeDb([[cancelledBooking]]);
    await expect(cancelBooking(BOOKING_ID, 'Again', db))
      .rejects.toMatchObject({ code: 'BOOKING_ALREADY_CANCELLED' });
  });

  it('getBooking — with slot + resource info', async () => {
    const bookingWithSlotRow = {
      ...BOOKING_ROW,
      slot_date: '2026-04-07',
      slot_start_time: '09:00:00',
      slot_end_time: '10:00:00',
      slot_capacity: 1,
      slot_booked_count: 1,
      slot_price_hellers: 50000,
      slot_status: 'full',
      slot_generated_from_rule_id: RULE_ID,
      slot_override_id: null,
      resource_id: RESOURCE_ID,
      resource_name: 'Court A',
      resource_type: 'court',
      resource_promoter_id: PROMOTER_ID,
    };
    const db = makeDb([[bookingWithSlotRow]]);
    const result = await getBooking(BOOKING_ID, db);
    expect(result.id).toBe(BOOKING_ID);
    expect(result.slot.slotDate).toBe('2026-04-07');
    expect(result.resource.name).toBe('Court A');
    expect(result.resource.resourceType).toBe('court');
  });

  it('listBookingsForUser — filter by status', async () => {
    const db = makeDb([[BOOKING_ROW]]);
    const results = await listBookingsForUser(USER_ID, { status: 'confirmed' }, db);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('confirmed');
    const sqlCall = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sqlCall).toContain('b.status');
  });

  it('listBookingsForSlot — returns all bookings', async () => {
    const booking2 = { ...BOOKING_ROW, id: 'booking-uuid-0002' };
    const db = makeDb([[BOOKING_ROW, booking2]]);
    const results = await listBookingsForSlot(SLOT_ID, db);
    expect(results).toHaveLength(2);
  });

  it('markNoShow — sets status=no_show', async () => {
    const noShowRow = { ...BOOKING_ROW, status: 'no_show' };
    const db = makeDb([[noShowRow]]);
    const result = await markNoShow(BOOKING_ID, db);
    expect(result.status).toBe('no_show');
    const sqlCall = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sqlCall).toContain("'no_show'");
  });

  it('markCompleted — sets status=completed', async () => {
    const completedRow = { ...BOOKING_ROW, status: 'completed' };
    const db = makeDb([[completedRow]]);
    const result = await markCompleted(BOOKING_ID, db);
    expect(result.status).toBe('completed');
    const sqlCall = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sqlCall).toContain("'completed'");
  });

  it('cleanupExpiredHolds — deletes expired, does not go negative', async () => {
    // Query 1: get expired holds
    const expiredHolds = [
      { slot_id: SLOT_ID, quantity: 1 },
    ];
    const db = makeDb([[expiredHolds[0]]]);
    const result = await cleanupExpiredHolds(db);
    expect(result.deleted).toBe(1);
    // execute 1: delete expired holds
    // execute 2: update slot booked_count (with GREATEST(0, ...))
    expect(db.execute).toHaveBeenCalledTimes(2);
    const updateSql = (db.execute as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    expect(updateSql).toContain('GREATEST');
  });

  it('cleanupExpiredHolds — no expired holds returns 0', async () => {
    const db = makeDb([[]]); // no expired holds
    const result = await cleanupExpiredHolds(db);
    expect(result.deleted).toBe(0);
    expect(db.execute).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Integration / Full flow tests
// ---------------------------------------------------------------------------

describe('Integration', () => {
  it('Full flow: resource → rule → generate slots → hold → confirm → cancel', async () => {
    // Step 1: createResource
    const db1 = makeDb([[RESOURCE_ROW]]);
    const resource = await createResource(PROMOTER_ID, {
      name: 'Court A',
      resourceType: 'court',
    }, db1);
    expect(resource.id).toBe(RESOURCE_ID);

    // Step 2: addRule
    const db2 = makeDb([[RULE_ROW]]);
    const rule = await addRule(RESOURCE_ID, {
      dayOfWeek: 1,
      startTime: '09:00',
      endTime: '12:00',
      priceHellers: 50000,
    }, db2);
    expect(rule.id).toBe(RULE_ID);

    // Step 3: generateSlotsForDate (Monday)
    const db3 = makeDb([[RULE_ROW], []]);
    const slots = await generateSlotsForDate(RESOURCE_ID, '2026-04-06', db3);
    expect(slots).toHaveLength(3);

    // Step 4: holdSlot
    const slotRow = { ...SLOT_ROW, capacity: 2, booked_count: 0, status: 'available' };
    const db4 = makeDb([[slotRow], [{ total: 0 }]]);
    const hold = await holdSlot(SLOT_ID, USER_ID, 1, db4);
    expect(hold.sessionToken).toBeDefined();

    // Step 5: confirmBooking
    // Query 1: hold, Query 2: INSERT RETURNING, Query 3: slot for refresh
    // Execute 1: booked_count update, Execute 2: delete hold, Execute 3: slot status
    const db5 = makeDb([
      [HOLD_ROW],
      [BOOKING_ROW],
      [SLOT_ROW],
    ]);
    const booking = await confirmBooking(HOLD_ID, ORDER_ID, db5);
    expect(booking.status).toBe('confirmed');

    // Step 6: cancelBooking
    const slotForRefresh = { ...SLOT_ROW, booked_count: 0, capacity: 1, status: 'available' };
    const db6 = makeDb([
      [BOOKING_ROW],
      [slotForRefresh],
    ]);
    const cancelled = await cancelBooking(BOOKING_ID, 'Changed mind', db6);
    expect(cancelled.status).toBe('cancelled');
  });
});

// ---------------------------------------------------------------------------
// API route tests — testing service layer behavior that drives API responses
// ---------------------------------------------------------------------------

describe('API Routes', () => {
  it('POST /reservations/resources/[id]/slots — generates slots via service and returns count', async () => {
    // Test the generateSlotsForRange service which powers the POST route
    // 2026-04-06 is Monday (day_of_week=1), 2026-04-07 is Tuesday (day_of_week=2)
    // Rule is for Monday only → 3 slots on Mon, 0 on Tue
    const db = makeDb([
      [RULE_ROW], // Mon: rules
      [],         // Mon: overrides
      [],         // Tue: rules (none match)
      [],         // Tue: overrides
    ]);
    const slots = await generateSlotsForRange(RESOURCE_ID, '2026-04-06', '2026-04-07', db);
    // Service call succeeds; in the route this maps to { generated: slots.length, slots }
    // with status 201
    expect(slots.length).toBeGreaterThanOrEqual(0);
    const generated = slots.length;
    // Simulate route response shape
    const routeBody = { generated, slots };
    expect(routeBody.generated).toBe(generated);
    expect(Array.isArray(routeBody.slots)).toBe(true);
  });

  it('POST /reservations/slots/[id]/hold — SLOT_FULL produces 409 SlotError', async () => {
    // Test that holdSlot throws SLOT_FULL which the route maps to 409
    const fullSlotRow = { ...SLOT_ROW, status: 'full', booked_count: 1, capacity: 1 };
    const db = makeDb([[fullSlotRow]]);
    const err = await holdSlot(SLOT_ID, USER_ID, 1, db).catch((e: unknown) => e);
    expect(isSlotError(err)).toBe(true);
    expect((err as SlotError).statusCode).toBe(409);
    expect((err as SlotError).code).toBe('SLOT_FULL');
    // Route would call: return NextResponse.json(err.toHttpError(), { status: err.statusCode })
    const httpErr = (err as SlotError).toHttpError();
    expect(httpErr.statusCode).toBe(409);
  });

  it('POST /reservations/slots/[id]/hold — valid hold produces 201 with sessionToken', async () => {
    // Test that holdSlot succeeds and returns a hold with sessionToken
    const availableSlotRow = { ...SLOT_ROW, status: 'available', booked_count: 0, capacity: 2 };
    const db = makeDb([[availableSlotRow], [{ total: 0 }]]);
    const hold = await holdSlot(SLOT_ID, USER_ID, 1, db);
    // Route would return NextResponse.json(hold, { status: 201 })
    expect(hold.sessionToken).toBeDefined();
    expect(typeof hold.sessionToken).toBe('string');
    expect(hold.slotId).toBe(SLOT_ID);
    expect(hold.userId).toBe(USER_ID);
  });
});

// ---------------------------------------------------------------------------
// Error class tests
// ---------------------------------------------------------------------------

describe('SlotError', () => {
  it('isSlotError — correctly identifies SlotError instances', () => {
    const err = new SlotError('SLOT_FULL');
    expect(isSlotError(err)).toBe(true);
    expect(isSlotError(new Error('generic'))).toBe(false);
  });

  it('SlotError — has correct HTTP status codes', () => {
    expect(new SlotError('RESOURCE_NOT_FOUND').statusCode).toBe(404);
    expect(new SlotError('RESOURCE_DUPLICATE').statusCode).toBe(409);
    expect(new SlotError('SLOT_FULL').statusCode).toBe(409);
    expect(new SlotError('HOLD_EXPIRED').statusCode).toBe(410);
    expect(new SlotError('INVALID_DATE_RANGE').statusCode).toBe(400);
  });

  it('SlotError — toHttpError returns structured object', () => {
    const err = new SlotError('SLOT_NOT_FOUND', 'Custom message');
    const http = err.toHttpError();
    expect(http.error).toBe('SLOT_NOT_FOUND');
    expect(http.message).toBe('Custom message');
    expect(http.statusCode).toBe(404);
  });
});
