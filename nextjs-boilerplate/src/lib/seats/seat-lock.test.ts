import { describe, it, expect, vi } from 'vitest';
import {
  acquireSeatLocks,
  releaseSeatLocks,
  finalizeSeatLocks,
  reapExpiredSeatLocks,
  SeatUnavailableError,
} from './seat-lock';

interface FakeDb {
  query: ReturnType<typeof vi.fn>;
}

function makeDb(...responses: Array<{ rows: unknown[] }>): FakeDb {
  const q = vi.fn();
  responses.forEach((r) => q.mockResolvedValueOnce(r));
  q.mockResolvedValue({ rows: [] });
  return { query: q };
}

describe('acquireSeatLocks', () => {
  it('returns immediately when seatIds is empty', async () => {
    const db = makeDb();
    await acquireSeatLocks([], 'o-1', 7, db as unknown as never);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('throws when seat is in active hold', async () => {
    const db = makeDb({ rows: [{ seat_id: 's-1' }] });
    await expect(
      acquireSeatLocks(['s-1', 's-2'], 'o-1', 7, db as unknown as never),
    ).rejects.toBeInstanceOf(SeatUnavailableError);
  });

  it('throws SEAT_UNAVAILABLE when not all seats can be locked', async () => {
    const db = makeDb(
      { rows: [] }, // no holds
      { rows: [{ id: 's-1' }] }, // only 1 of 2 locked
    );
    await expect(
      acquireSeatLocks(['s-1', 's-2'], 'o-1', 7, db as unknown as never),
    ).rejects.toBeInstanceOf(SeatUnavailableError);
  });

  it('succeeds when all seats are locked', async () => {
    const db = makeDb(
      { rows: [] }, // no holds
      { rows: [{ id: 's-1' }, { id: 's-2' }] },
    );
    await expect(
      acquireSeatLocks(['s-1', 's-2'], 'o-1', 7, db as unknown as never),
    ).resolves.toBeUndefined();
  });
});

describe('releaseSeatLocks / finalizeSeatLocks / reapExpiredSeatLocks', () => {
  it('release runs the right SQL', async () => {
    const db = makeDb({ rows: [] });
    await releaseSeatLocks('o-1', db as unknown as never);
    const sql = db.query.mock.calls[0]?.[0] as string;
    expect(sql).toContain("status = 'available'");
    expect(sql).toContain('locked_by_order_id = $1');
  });

  it('finalize transitions locked → sold', async () => {
    const db = makeDb({ rows: [{ id: 's-1' }, { id: 's-2' }] });
    const count = await finalizeSeatLocks('o-1', db as unknown as never);
    expect(count).toBe(2);
    const sql = db.query.mock.calls[0]?.[0] as string;
    expect(sql).toContain("status = 'sold'");
  });

  it('reap cleans expired locks', async () => {
    const db = makeDb({ rows: [{ id: 's-1' }] });
    const count = await reapExpiredSeatLocks(db as unknown as never);
    expect(count).toBe(1);
    const sql = db.query.mock.calls[0]?.[0] as string;
    expect(sql).toContain('locked_until < NOW()');
  });
});
