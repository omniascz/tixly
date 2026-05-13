/**
 * Extended timed-entry tests — covers edge cases for bulk slot creation,
 * capacity transitions, and validation scenarios not in entry.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { bulkCreateSlots, updateSlotCapacity, closeSlot } from '../services/slot.service';
import { listBookingsForUser, listBookingsForSlot } from '../services/booking.service';
import { EntryError, isEntryError } from '../lib/entry-errors';

function makeDb() {
  return {
    query: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
  };
}

const SLOT_ROW = {
  id: 'slot-1',
  venue_id: 'venue-1',
  slot_date: '2026-06-01',
  entry_time: '10:00',
  exit_time: '11:00',
  capacity: 50,
  booked_count: 10,
  status: 'available',
  notes: null,
};

// ---------------------------------------------------------------------------
// bulkCreateSlots
// ---------------------------------------------------------------------------
describe('bulkCreateSlots', () => {
  it('creates multiple slots in single query', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [SLOT_ROW, { ...SLOT_ROW, id: 'slot-2', entry_time: '11:00' }] });
    const r = await bulkCreateSlots('venue-1', [
      { slotDate: '2026-06-01', entryTime: '10:00', exitTime: '11:00', capacity: 50 },
      { slotDate: '2026-06-01', entryTime: '11:00', exitTime: '12:00', capacity: 50 },
    ], db);
    expect(r).toHaveLength(2);
    expect(db.query).toHaveBeenCalledOnce();
  });

  it('returns empty array for empty input', async () => {
    const db = makeDb();
    const r = await bulkCreateSlots('venue-1', [], db);
    expect(r).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('builds correct VALUES placeholders for n=3 slots', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [] });
    await bulkCreateSlots('venue-1', [
      { slotDate: '2026-06-01', entryTime: '10:00', exitTime: '11:00', capacity: 50 },
      { slotDate: '2026-06-01', entryTime: '11:00', exitTime: '12:00', capacity: 50 },
      { slotDate: '2026-06-01', entryTime: '12:00', exitTime: '13:00', capacity: 50 },
    ], db);
    const sql = db.query.mock.calls[0][0] as string;
    // 3 slots × 6 columns = 18 params
    expect(sql).toContain('($1,$2,$3,$4,$5,$6)');
    expect(sql).toContain('($7,$8,$9,$10,$11,$12)');
    expect(sql).toContain('($13,$14,$15,$16,$17,$18)');
    expect(sql).toContain('ON CONFLICT DO NOTHING');
  });

  it('passes notes as null when omitted', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [] });
    await bulkCreateSlots('venue-1', [
      { slotDate: '2026-06-01', entryTime: '10:00', exitTime: '11:00', capacity: 50 },
    ], db);
    const params = db.query.mock.calls[0][1];
    expect(params[5]).toBeNull();
  });

  it('returns rows for slots that were inserted (skipping conflicts)', async () => {
    const db = makeDb();
    // ON CONFLICT DO NOTHING returns only inserted rows (1 of 2)
    db.query.mockResolvedValueOnce({ rows: [SLOT_ROW] });
    const r = await bulkCreateSlots('venue-1', [
      { slotDate: '2026-06-01', entryTime: '10:00', exitTime: '11:00', capacity: 50 },
      { slotDate: '2026-06-01', entryTime: '10:00', exitTime: '11:00', capacity: 50 },  // duplicate
    ], db);
    expect(r).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// updateSlotCapacity — state transitions
// ---------------------------------------------------------------------------
describe('updateSlotCapacity', () => {
  it('reduces capacity when above current bookings', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [{ ...SLOT_ROW, capacity: 30 }] });
    const r = await updateSlotCapacity('slot-1', 30, db);
    expect(r.capacity).toBe(30);
  });

  it('increases capacity flips full→available via SQL CASE', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({
      rows: [{ ...SLOT_ROW, status: 'available', capacity: 100 }],
    });
    const r = await updateSlotCapacity('slot-1', 100, db);
    expect(r.status).toBe('available');
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain("status = 'full' AND booked_count < $1");
  });

  it('triggers full status when capacity matches booked_count', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({
      rows: [{ ...SLOT_ROW, capacity: 10, booked_count: 10, status: 'full' }],
    });
    const r = await updateSlotCapacity('slot-1', 10, db);
    expect(r.status).toBe('full');
  });

  it('throws SLOT_NOT_FOUND when capacity below booked count (rejected by WHERE)', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [] });
    await expect(updateSlotCapacity('slot-1', 5, db)).rejects.toThrow(EntryError);
  });
});

// ---------------------------------------------------------------------------
// closeSlot
// ---------------------------------------------------------------------------
describe('closeSlot', () => {
  it('updates status to closed', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [{ ...SLOT_ROW, status: 'closed' }] });
    const r = await closeSlot('slot-1', db);
    expect(r.status).toBe('closed');
  });

  it('throws SLOT_NOT_FOUND when slot does not exist', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [] });
    await expect(closeSlot('missing', db)).rejects.toThrow(EntryError);
  });
});

// ---------------------------------------------------------------------------
// listBookingsForUser
// ---------------------------------------------------------------------------
describe('listBookingsForUser', () => {
  it('only returns active bookings for upcoming slots', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({
      rows: [
        { id: 'b1', user_id: 'u1', entry_slot_id: 'slot-1', booking_ref: 'REF1', ticket_count: 2,
          attendee_email: 'a@b.cz', total_hellers: 100, status: 'confirmed',
          qr_token: 'tok1', checked_in_at: null, created_at: new Date() },
      ],
    });
    const r = await listBookingsForUser('u1', db);
    expect(r).toHaveLength(1);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain("status NOT IN ('cancelled','expired')");
    expect(sql).toContain('slot_date >= CURRENT_DATE');
  });
});

// ---------------------------------------------------------------------------
// listBookingsForSlot
// ---------------------------------------------------------------------------
describe('listBookingsForSlot', () => {
  it('returns booking stats for slot', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({
      rows: [
        { id: 'b1', user_id: 'u1', entry_slot_id: 'slot-1', booking_ref: 'REF1', ticket_count: 1,
          attendee_email: 'a@b.cz', total_hellers: 50, status: 'confirmed',
          qr_token: 'x', checked_in_at: null, created_at: new Date() },
      ],
    });
    const stats = await listBookingsForSlot('slot-1', db);
    // returns BookingSlotStats — has bookings array or count
    expect(stats).toBeDefined();
  });

  it('uses entry_slot_id in WHERE clause', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [] });
    await listBookingsForSlot('slot-1', db);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('entry_slot_id');
  });
});

// ---------------------------------------------------------------------------
// EntryError helper
// ---------------------------------------------------------------------------
describe('EntryError', () => {
  it('isEntryError type guard discriminates correctly', () => {
    expect(isEntryError(new EntryError('SLOT_NOT_FOUND'))).toBe(true);
    expect(isEntryError(new Error('plain'))).toBe(false);
    expect(isEntryError('string')).toBe(false);
    expect(isEntryError(null)).toBe(false);
  });

  it('SLOT_FULL is 409 conflict', () => {
    expect(new EntryError('SLOT_FULL').statusCode).toBe(409);
  });

  it('toHttpError returns object with code', () => {
    const err = new EntryError('VENUE_NOT_FOUND');
    const http = err.toHttpError();
    expect(http.error).toBe('VENUE_NOT_FOUND');
    expect(http.statusCode).toBe(404);
  });
});
