/**
 * Tests for open-shifts service (claim flow and slot counting).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createOpenShift,
  listOpenShifts,
  claimOpenShift,
  closeOpenShift,
} from '../services/open-shifts.service.js';

function makeDb() {
  const db: any = {
    query: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(async (fn: any) => fn(db)),
  };
  return db;
}

const PROMOTER = 'p-1';
const EVENT = 'e-1';
const STAFF = 's-1';
const OPEN_SHIFT_ID = 'os-1';

const baseOpenShift = {
  id: OPEN_SHIFT_ID,
  promoterId: PROMOTER,
  eventId: EVENT,
  requiredRole: 'security',
  zone: 'Vstup',
  startsAt: '2026-04-20T18:00:00Z',
  endsAt: '2026-04-20T23:00:00Z',
  hourlyRateHalire: 20000,
  slotsTotal: 2,
  slotsClaimed: 0,
  isActive: true,
  createdAt: '2026-04-10T10:00:00Z',
};

describe('createOpenShift', () => {
  it('creates open shift with slots', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([baseOpenShift]);

    const result = await createOpenShift(
      PROMOTER,
      {
        eventId: EVENT,
        requiredRole: 'security',
        zone: 'Vstup',
        startsAt: '2026-04-20T18:00:00Z',
        endsAt: '2026-04-20T23:00:00Z',
        hourlyRateHalire: 20000,
        slotsTotal: 2,
      },
      { db },
    );

    expect(result.slotsTotal).toBe(2);
    expect(result.slotsClaimed).toBe(0);
    expect(result.isActive).toBe(true);
  });

  it('throws SHIFT_INVALID_TIME_RANGE when end <= start', async () => {
    const db = makeDb();
    await expect(
      createOpenShift(
        PROMOTER,
        {
          eventId: EVENT,
          requiredRole: 'security',
          startsAt: '2026-04-20T23:00:00Z',
          endsAt: '2026-04-20T18:00:00Z',
        },
        { db },
      ),
    ).rejects.toMatchObject({ code: 'SHIFT_INVALID_TIME_RANGE' });
  });
});

describe('claimOpenShift', () => {
  it('creates shift and increments slots_claimed', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce([{ // FOR UPDATE lock
        id: OPEN_SHIFT_ID,
        event_id: EVENT,
        required_role: 'security',
        zone: 'Vstup',
        starts_at: '2026-04-20T18:00:00Z',
        ends_at: '2026-04-20T23:00:00Z',
        slots_total: 2,
        slots_claimed: 0,
        is_active: true,
      }])
      .mockResolvedValueOnce([{ role: 'security' }]) // roles check
      .mockResolvedValueOnce([]) // overlap check
      .mockResolvedValueOnce([{ id: 'new-shift-id' }]) // insert shift
      .mockResolvedValueOnce([{ ...baseOpenShift, slotsClaimed: 1 }]); // update

    const result = await claimOpenShift(OPEN_SHIFT_ID, STAFF, PROMOTER, { db });
    expect(result.openShift.slotsClaimed).toBe(1);
    expect(result.shiftId).toBe('new-shift-id');
  });

  it('throws OPEN_SHIFT_ALREADY_CLAIMED when all slots taken', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{
      id: OPEN_SHIFT_ID,
      event_id: EVENT,
      required_role: 'security',
      zone: null,
      starts_at: '2026-04-20T18:00:00Z',
      ends_at: '2026-04-20T23:00:00Z',
      slots_total: 1,
      slots_claimed: 1, // already full
      is_active: true,
    }]);

    await expect(
      claimOpenShift(OPEN_SHIFT_ID, STAFF, PROMOTER, { db }),
    ).rejects.toMatchObject({ code: 'OPEN_SHIFT_ALREADY_CLAIMED' });
  });

  it('throws STAFF_INVALID_ROLE when staff lacks required role', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce([{
        id: OPEN_SHIFT_ID,
        event_id: EVENT,
        required_role: 'security',
        zone: null,
        starts_at: '2026-04-20T18:00:00Z',
        ends_at: '2026-04-20T23:00:00Z',
        slots_total: 2,
        slots_claimed: 0,
        is_active: true,
      }])
      .mockResolvedValueOnce([{ role: 'bar' }]); // wrong role

    await expect(
      claimOpenShift(OPEN_SHIFT_ID, STAFF, PROMOTER, { db }),
    ).rejects.toMatchObject({ code: 'STAFF_INVALID_ROLE' });
  });
});

describe('closeOpenShift', () => {
  it('sets is_active=false', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ ...baseOpenShift, isActive: false }]);

    const result = await closeOpenShift(OPEN_SHIFT_ID, PROMOTER, { db });
    expect(result.isActive).toBe(false);
  });

  it('throws OPEN_SHIFT_NOT_FOUND for wrong promoter', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([]);

    await expect(
      closeOpenShift(OPEN_SHIFT_ID, 'wrong', { db }),
    ).rejects.toMatchObject({ code: 'OPEN_SHIFT_NOT_FOUND' });
  });
});
