import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createShift,
  bulkCreateShifts,
  updateShift,
  cancelShift,
  checkInShift,
  checkOutShift,
  getEventShiftTimeline,
} from '../services/shifts.service.js';
import type { ServiceDeps } from '../lib/service-container.js';

function makeDb() {
  const db: any = {
    query: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(async (fn: any) => fn(db)),
  };
  return db;
}

function makeDeps(db: any): ServiceDeps {
  return { db };
}

const PROMOTER = 'p-1';
const EVENT = 'e-1';
const STAFF_ID = '00000000-0000-0000-0000-000000000001';
const SHIFT_ID = 'sh-1';

const STAFF_OK = { id: STAFF_ID, hourly_rate_halire: 25000 };

const NOW = new Date('2026-04-08T18:00:00Z');
const LATER = new Date('2026-04-08T22:00:00Z');

function makeShiftRow(overrides: Partial<any> = {}) {
  return {
    id: SHIFT_ID,
    promoter_id: PROMOTER,
    event_id: EVENT,
    staff_id: STAFF_ID,
    role: 'security',
    zone: 'Hlavní vchod',
    starts_at: NOW,
    ends_at: LATER,
    status: 'scheduled',
    notes: null,
    actual_starts_at: null,
    actual_ends_at: null,
    payout_halire: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

describe('createShift', () => {
  let db: any;
  beforeEach(() => {
    db = makeDb();
  });

  it('happy path: verifies staff and inserts', async () => {
    db.query
      .mockResolvedValueOnce([STAFF_OK]) // staff lookup
      .mockResolvedValueOnce([]) // overlap check
      .mockResolvedValueOnce([makeShiftRow()]); // INSERT RETURNING

    const result = await createShift(
      PROMOTER,
      EVENT,
      {
        staffId: STAFF_ID,
        role: 'security',
        zone: 'Hlavní vchod',
        startsAt: NOW.toISOString(),
        endsAt: LATER.toISOString(),
      },
      makeDeps(db),
    );

    expect(result.id).toBe(SHIFT_ID);
    expect(result.role).toBe('security');
    expect(db.query).toHaveBeenCalledTimes(3);
    const insertSql = db.query.mock.calls[2][0];
    expect(insertSql).toContain('INSERT INTO platform.staff_shifts');
  });

  it('throws SHIFT_INVALID_TIME_RANGE without DB calls when start >= end', async () => {
    await expect(
      createShift(
        PROMOTER,
        EVENT,
        {
          staffId: STAFF_ID,
          role: 'security',
          startsAt: LATER.toISOString(),
          endsAt: NOW.toISOString(),
        },
        makeDeps(db),
      ),
    ).rejects.toMatchObject({ code: 'SHIFT_INVALID_TIME_RANGE' });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('throws SHIFT_OVERLAP when existing shift overlaps', async () => {
    db.query
      .mockResolvedValueOnce([STAFF_OK])
      .mockResolvedValueOnce([{ id: 'other-shift' }]); // overlap found

    await expect(
      createShift(
        PROMOTER,
        EVENT,
        {
          staffId: STAFF_ID,
          role: 'security',
          startsAt: NOW.toISOString(),
          endsAt: LATER.toISOString(),
        },
        makeDeps(db),
      ),
    ).rejects.toMatchObject({ code: 'SHIFT_OVERLAP' });
  });

  it('throws STAFF_NOT_FOUND when staff archived/missing', async () => {
    db.query.mockResolvedValueOnce([]); // staff query returns nothing (filter excludes archived)

    await expect(
      createShift(
        PROMOTER,
        EVENT,
        {
          staffId: STAFF_ID,
          role: 'security',
          startsAt: NOW.toISOString(),
          endsAt: LATER.toISOString(),
        },
        makeDeps(db),
      ),
    ).rejects.toMatchObject({ code: 'STAFF_NOT_FOUND' });
  });

  it('throws STAFF_NOT_FOUND for wrong promoter (anti-enumeration)', async () => {
    db.query.mockResolvedValueOnce([]);

    await expect(
      createShift(
        'wrong-promoter',
        EVENT,
        {
          staffId: STAFF_ID,
          role: 'security',
          startsAt: NOW.toISOString(),
          endsAt: LATER.toISOString(),
        },
        makeDeps(db),
      ),
    ).rejects.toMatchObject({ code: 'STAFF_NOT_FOUND' });
  });
});

describe('bulkCreateShifts', () => {
  it('returns successes and conflicts (1 overlap of 3)', async () => {
    const db = makeDb();
    // staff A: ok lookup + no overlap + insert
    // staff B: ok lookup + overlap
    // staff C: ok lookup + no overlap + insert
    db.query
      .mockResolvedValueOnce([{ id: 'a', hourly_rate_halire: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeShiftRow({ id: 'sh-a', staff_id: 'a' })])
      .mockResolvedValueOnce([{ id: 'b', hourly_rate_halire: 0 }])
      .mockResolvedValueOnce([{ id: 'existing' }]) // overlap
      .mockResolvedValueOnce([{ id: 'c', hourly_rate_halire: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeShiftRow({ id: 'sh-c', staff_id: 'c' })]);

    const result = await bulkCreateShifts(
      PROMOTER,
      EVENT,
      {
        staffIds: ['a', 'b', 'c'],
        role: 'usher',
        startsAt: NOW.toISOString(),
        endsAt: LATER.toISOString(),
      },
      makeDeps(db),
    );

    expect(result.created).toHaveLength(2);
    expect(result.conflicts).toEqual([{ staffId: 'b', reason: 'overlap' }]);
  });
});

describe('updateShift', () => {
  it('changing time re-checks overlap excluding self', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce([makeShiftRow()]) // load existing
      .mockResolvedValueOnce([]) // overlap check (no conflict, self-excluded)
      .mockResolvedValueOnce([makeShiftRow({ starts_at: new Date('2026-04-09T18:00:00Z') })]); // update returning

    await updateShift(
      SHIFT_ID,
      PROMOTER,
      { startsAt: '2026-04-09T18:00:00Z', endsAt: '2026-04-09T22:00:00Z' },
      makeDeps(db),
    );

    const overlapCall = db.query.mock.calls[1];
    expect(overlapCall[0]).toContain('id <> $4');
    expect(overlapCall[1]).toContain(SHIFT_ID);
  });

  it('forbidden status transition completed -> scheduled throws', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([makeShiftRow({ status: 'completed' })]);

    await expect(
      updateShift(SHIFT_ID, PROMOTER, { status: 'scheduled' }, makeDeps(db)),
    ).rejects.toMatchObject({ code: 'SHIFT_INVALID_STATUS_TRANSITION' });
  });
});

describe('cancelShift', () => {
  it('sets status=cancelled', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce([makeShiftRow()]) // load
      .mockResolvedValueOnce([makeShiftRow({ status: 'cancelled' })]); // update returning

    const result = await cancelShift(SHIFT_ID, PROMOTER, makeDeps(db));
    expect(result.status).toBe('cancelled');
    const updateSql = db.query.mock.calls[1][0];
    expect(updateSql).toContain("status = 'cancelled'");
  });

  it('overlap check ignores cancelled shifts (SQL contains exclusion)', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce([STAFF_OK])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeShiftRow()]);

    await createShift(
      PROMOTER,
      EVENT,
      {
        staffId: STAFF_ID,
        role: 'security',
        startsAt: NOW.toISOString(),
        endsAt: LATER.toISOString(),
      },
      makeDeps(db),
    );

    const overlapSql = db.query.mock.calls[1][0];
    expect(overlapSql).toContain("'cancelled'");
    expect(overlapSql).toContain("'no_show'");
  });
});

describe('checkInShift', () => {
  it('confirmed -> in_progress with actual_starts_at', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce([makeShiftRow({ status: 'confirmed' })])
      .mockResolvedValueOnce([
        makeShiftRow({ status: 'in_progress', actual_starts_at: NOW }),
      ]);

    const result = await checkInShift(SHIFT_ID, PROMOTER, makeDeps(db));
    expect(result.status).toBe('in_progress');
    expect(result.actualStartsAt).toBeTruthy();
    const updateSql = db.query.mock.calls[1][0];
    expect(updateSql).toContain("status = 'in_progress'");
    expect(updateSql).toContain('actual_starts_at = NOW()');
  });

  it('throws when checking in from completed', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([makeShiftRow({ status: 'completed' })]);
    await expect(
      checkInShift(SHIFT_ID, PROMOTER, makeDeps(db)),
    ).rejects.toMatchObject({ code: 'SHIFT_INVALID_STATUS_TRANSITION' });
  });
});

describe('checkOutShift', () => {
  it('computes payout from hourly rate (4h × 25000 halíře/h = 100000)', async () => {
    const db = makeDb();
    const startedAt = new Date(Date.now() - 4 * 60 * 60 * 1000); // 4 hours ago
    db.query
      .mockResolvedValueOnce([
        makeShiftRow({ status: 'in_progress', actual_starts_at: startedAt }),
      ]) // load
      .mockResolvedValueOnce([{ hourly_rate_halire: 25000 }]) // staff lookup
      .mockResolvedValueOnce([
        makeShiftRow({ status: 'completed', payout_halire: 100000 }),
      ]); // update

    const result = await checkOutShift(SHIFT_ID, PROMOTER, makeDeps(db));
    expect(result.status).toBe('completed');

    const updateCall = db.query.mock.calls[2];
    const params = updateCall[1];
    // params: [actualEndsAt, payoutHalire, shiftId, promoterId]
    const payoutParam = params[1];
    expect(payoutParam).toBe(100000);
    expect(Number.isInteger(payoutParam)).toBe(true);
  });

  it('payout is integer (Math.round, not float)', async () => {
    const db = makeDb();
    const startedAt = new Date(Date.now() - 33 * 60 * 1000); // 33 minutes
    db.query
      .mockResolvedValueOnce([
        makeShiftRow({ status: 'in_progress', actual_starts_at: startedAt }),
      ])
      .mockResolvedValueOnce([{ hourly_rate_halire: 17777 }])
      .mockResolvedValueOnce([makeShiftRow({ status: 'completed' })]);

    await checkOutShift(SHIFT_ID, PROMOTER, makeDeps(db));
    const payoutParam = db.query.mock.calls[2][1][1];
    expect(Number.isInteger(payoutParam)).toBe(true);
  });
});

describe('getEventShiftTimeline', () => {
  it('groups shifts by UTC date and sorts ascending', async () => {
    const db = makeDb();
    const day1a = new Date('2026-04-10T18:00:00Z');
    const day1b = new Date('2026-04-10T20:00:00Z');
    const day2 = new Date('2026-04-11T18:00:00Z');

    db.query.mockResolvedValueOnce([
      {
        ...makeShiftRow({ id: 's-2', starts_at: day1b, ends_at: new Date('2026-04-10T23:00:00Z') }),
        first_name: 'Eva',
        last_name: 'Bar',
        phone: null,
      },
      {
        ...makeShiftRow({ id: 's-3', starts_at: day2, ends_at: new Date('2026-04-11T22:00:00Z') }),
        first_name: 'Petr',
        last_name: 'Tech',
        phone: null,
      },
      {
        ...makeShiftRow({ id: 's-1', starts_at: day1a, ends_at: new Date('2026-04-10T22:00:00Z') }),
        first_name: 'Jan',
        last_name: 'Sec',
        phone: null,
      },
    ]);

    const slots = await getEventShiftTimeline(EVENT, PROMOTER, makeDeps(db));
    expect(slots.map((s) => s.date)).toEqual(['2026-04-10', '2026-04-11']);
    expect(slots[0]?.shifts.map((s) => s.id)).toEqual(['s-1', 's-2']);
    expect(slots[1]?.shifts).toHaveLength(1);
  });
});
