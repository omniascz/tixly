import { describe, it, expect, vi } from 'vitest';
import {
  createOpenShift,
  listOpenShifts,
  claimOpenShift,
  closeOpenShift,
} from '../services/open-shifts.service.js';
import { StaffError } from '../lib/staff-errors.js';

function makeDb() {
  const db: any = {
    query: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(async (fn: any) => fn(db)),
  };
  return db;
}
const deps = (db: any) => ({ db });

const PROMOTER = 'p-1';
const EVENT_ID = 'e-1';
const OPEN_SHIFT_ID = 'os-1';
const STAFF_ID = 'st-1';

const OPEN_ROW = {
  id: OPEN_SHIFT_ID,
  promoterId: PROMOTER,
  eventId: EVENT_ID,
  requiredRole: 'security',
  zone: null,
  startsAt: '2026-06-01T18:00:00Z',
  endsAt: '2026-06-01T23:00:00Z',
  hourlyRateHalire: 25000,
  slotsTotal: 2,
  slotsClaimed: 0,
  isActive: true,
  createdAt: '2026-04-11T10:00:00Z',
};

describe('createOpenShift', () => {
  it('creates an open shift with 2 slots', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([OPEN_ROW]);
    const r = await createOpenShift(PROMOTER, {
      eventId: EVENT_ID, requiredRole: 'security',
      startsAt: '2026-06-01T18:00:00Z', endsAt: '2026-06-01T23:00:00Z',
      hourlyRateHalire: 25000, slotsTotal: 2,
    }, deps(db));
    expect(r.slotsTotal).toBe(2);
    expect(r.slotsClaimed).toBe(0);
  });

  it('defaults slotsTotal to 1', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ ...OPEN_ROW, slotsTotal: 1 }]);
    await createOpenShift(PROMOTER, {
      eventId: EVENT_ID, requiredRole: 'bar',
      startsAt: '2026-06-01T18:00:00Z', endsAt: '2026-06-01T23:00:00Z',
    }, deps(db));
    const params = db.query.mock.calls[0][1];
    expect(params[7]).toBe(1);
  });

  it('rejects invalid time range', async () => {
    const db = makeDb();
    await expect(createOpenShift(PROMOTER, {
      eventId: EVENT_ID, requiredRole: 'security',
      startsAt: '2026-06-01T23:00:00Z', endsAt: '2026-06-01T18:00:00Z',
    }, deps(db))).rejects.toMatchObject({ code: 'SHIFT_INVALID_TIME_RANGE' });
  });
});

describe('listOpenShifts', () => {
  it('lists active shifts with remaining slots', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([OPEN_ROW]);
    const r = await listOpenShifts(PROMOTER, undefined, deps(db));
    expect(r).toHaveLength(1);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('slots_claimed < slots_total');
  });

  it('filters by event', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([OPEN_ROW]);
    await listOpenShifts(PROMOTER, EVENT_ID, deps(db));
    const params = db.query.mock.calls[0][1];
    expect(params).toContain(EVENT_ID);
  });
});

describe('claimOpenShift', () => {
  it('atomically claims a slot and creates shift', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce([{           // SELECT FOR UPDATE
        id: OPEN_SHIFT_ID, event_id: EVENT_ID, required_role: 'security', zone: null,
        starts_at: '2026-06-01T18:00:00Z', ends_at: '2026-06-01T23:00:00Z',
        slots_total: 2, slots_claimed: 0, is_active: true,
      }])
      .mockResolvedValueOnce([{ role: 'security' }])  // staff roles
      .mockResolvedValueOnce([])                      // no overlap
      .mockResolvedValueOnce([{ id: 'new-shift' }])   // insert shift
      .mockResolvedValueOnce([{ ...OPEN_ROW, slotsClaimed: 1 }]); // update open shift
    const r = await claimOpenShift(OPEN_SHIFT_ID, STAFF_ID, PROMOTER, deps(db));
    expect(r.shiftId).toBe('new-shift');
    expect(r.openShift.slotsClaimed).toBe(1);
  });

  it('throws when open shift is full', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{
      id: OPEN_SHIFT_ID, event_id: EVENT_ID, required_role: 'security', zone: null,
      starts_at: '2026-06-01T18:00:00Z', ends_at: '2026-06-01T23:00:00Z',
      slots_total: 2, slots_claimed: 2, is_active: true,
    }]);
    await expect(claimOpenShift(OPEN_SHIFT_ID, STAFF_ID, PROMOTER, deps(db)))
      .rejects.toMatchObject({ code: 'OPEN_SHIFT_ALREADY_CLAIMED' });
  });

  it('throws when open shift is inactive', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{
      id: OPEN_SHIFT_ID, event_id: EVENT_ID, required_role: 'security', zone: null,
      starts_at: '2026-06-01T18:00:00Z', ends_at: '2026-06-01T23:00:00Z',
      slots_total: 2, slots_claimed: 0, is_active: false,
    }]);
    await expect(claimOpenShift(OPEN_SHIFT_ID, STAFF_ID, PROMOTER, deps(db)))
      .rejects.toMatchObject({ code: 'OPEN_SHIFT_ALREADY_CLAIMED' });
  });

  it('throws STAFF_INVALID_ROLE when staff lacks required role', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce([{
        id: OPEN_SHIFT_ID, event_id: EVENT_ID, required_role: 'security', zone: null,
        starts_at: '2026-06-01T18:00:00Z', ends_at: '2026-06-01T23:00:00Z',
        slots_total: 2, slots_claimed: 0, is_active: true,
      }])
      .mockResolvedValueOnce([{ role: 'bar' }]);  // staff has wrong role
    await expect(claimOpenShift(OPEN_SHIFT_ID, STAFF_ID, PROMOTER, deps(db)))
      .rejects.toMatchObject({ code: 'STAFF_INVALID_ROLE' });
  });

  it('throws SHIFT_OVERLAP when staff has conflicting shift', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce([{
        id: OPEN_SHIFT_ID, event_id: EVENT_ID, required_role: 'security', zone: null,
        starts_at: '2026-06-01T18:00:00Z', ends_at: '2026-06-01T23:00:00Z',
        slots_total: 2, slots_claimed: 0, is_active: true,
      }])
      .mockResolvedValueOnce([{ role: 'security' }])
      .mockResolvedValueOnce([{ id: 'conflict-shift' }]);
    await expect(claimOpenShift(OPEN_SHIFT_ID, STAFF_ID, PROMOTER, deps(db)))
      .rejects.toMatchObject({ code: 'SHIFT_OVERLAP' });
  });

  it('throws OPEN_SHIFT_NOT_FOUND for wrong promoter', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([]);
    await expect(claimOpenShift(OPEN_SHIFT_ID, STAFF_ID, 'other-promoter', deps(db)))
      .rejects.toMatchObject({ code: 'OPEN_SHIFT_NOT_FOUND' });
  });
});

describe('closeOpenShift', () => {
  it('deactivates an open shift', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ ...OPEN_ROW, isActive: false }]);
    const r = await closeOpenShift(OPEN_SHIFT_ID, PROMOTER, deps(db));
    expect(r.isActive).toBe(false);
  });

  it('throws when not found', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([]);
    await expect(closeOpenShift(OPEN_SHIFT_ID, PROMOTER, deps(db))).rejects.toThrow(StaffError);
  });
});
