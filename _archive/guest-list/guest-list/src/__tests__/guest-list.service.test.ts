import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GuestListService } from '../services/guest-list.service.js';
import type { GuestListDbAdapter, KafkaProducerAdapter } from '../services/guest-list.service.js';
import type { GuestEntry, GuestListSummary } from '../types/guest-list.types.js';
import {
  GuestNotFoundError,
  GuestAlreadyCheckedInError,
  GuestDuplicateError,
} from '../types/guest-list.types.js';

// ---------------------------------------------------------------------------
// Mock Adapters
// ---------------------------------------------------------------------------

function makeMockDb(): GuestListDbAdapter {
  return {
    findGuest: vi.fn(),
    findGuestByEmail: vi.fn(),
    createGuest: vi.fn(),
    updateGuest: vi.fn(),
    listGuestsByEvent: vi.fn(),
    searchGuestsByEvent: vi.fn(),
    getEventSummary: vi.fn(),
    checkOrganizerOwnership: vi.fn(),
    withTransaction: vi.fn(),
  };
}

function makeMockKafka(): KafkaProducerAdapter {
  return {
    publish: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EVENT_ID = 'event-uuid-001';
const USER_ID = 'user-uuid-001';
const STAFF_ID = 'staff-uuid-001';
const GUEST_ID = 'guest-uuid-001';

const MOCK_GUEST: GuestEntry = {
  id: GUEST_ID,
  event_id: EVENT_ID,
  name: 'Jane Smith',
  email: 'jane@example.com',
  phone: '+420987654321',
  guest_type: 'vip',
  status: 'invited',
  plus_count: 2,
  total_count: 3,
  zone_access: ['zone-1', 'zone-2'],
  notes: 'Premium guest',
  added_by_user_id: USER_ID,
  confirmed_at: null,
  checked_in_at: null,
  checked_in_by_staff_id: null,
  created_at: new Date(),
  updated_at: new Date(),
};

const MOCK_SUMMARY: GuestListSummary = {
  totalInvited: 100,
  totalConfirmed: 80,
  totalCheckedIn: 60,
  totalNoShow: 10,
  totalCancelled: 10,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GuestListService', () => {
  let db: GuestListDbAdapter;
  let kafka: KafkaProducerAdapter;

  beforeEach(() => {
    db = makeMockDb();
    kafka = makeMockKafka();
  });

  // -------------------------------------------------------------------------
  // 1. addGuest
  // -------------------------------------------------------------------------

  it('1. addGuest — creates guest and publishes event', async () => {
    vi.mocked(db.findGuestByEmail).mockResolvedValue(null);
    vi.mocked(db.createGuest).mockResolvedValue(MOCK_GUEST);

    const result = await GuestListService.addGuest(
      EVENT_ID,
      USER_ID,
      {
        name: 'Jane Smith',
        email: 'jane@example.com',
        phone: '+420987654321',
        guestType: 'vip',
        plusCount: 2,
        zoneAccess: ['zone-1', 'zone-2'],
        notes: 'Premium guest',
      },
      db,
      kafka
    );

    expect(result.id).toBe(GUEST_ID);
    expect(result.name).toBe('Jane Smith');
    expect(result.status).toBe('invited');
    expect(result.total_count).toBe(3);
    expect(vi.mocked(kafka.publish)).toHaveBeenCalledWith('guest.invited', expect.objectContaining({
      guestId: GUEST_ID,
      eventId: EVENT_ID,
    }));
  });

  it('2. addGuest — without email', async () => {
    vi.mocked(db.createGuest).mockResolvedValue({ ...MOCK_GUEST, email: null });

    const result = await GuestListService.addGuest(
      EVENT_ID,
      USER_ID,
      {
        name: 'John Doe',
        guestType: 'regular',
        plusCount: 0,
      },
      db,
      kafka
    );

    expect(result.email).toBeNull();
    expect(vi.mocked(db.findGuestByEmail)).not.toHaveBeenCalled();
  });

  it('3. addGuest — duplicate email throws', async () => {
    vi.mocked(db.findGuestByEmail).mockResolvedValue(MOCK_GUEST);

    await expect(
      GuestListService.addGuest(
        EVENT_ID,
        USER_ID,
        {
          name: 'Jane Smith',
          email: 'jane@example.com',
          guestType: 'vip',
          plusCount: 2,
        },
        db,
        kafka
      )
    ).rejects.toThrow(GuestDuplicateError);
  });

  // -------------------------------------------------------------------------
  // 4. bulkAddGuests
  // -------------------------------------------------------------------------

  it('4. bulkAddGuests — adds multiple guests', async () => {
    const guest1 = { ...MOCK_GUEST, id: 'g1' };
    const guest2 = { ...MOCK_GUEST, id: 'g2', name: 'Bob Smith' };

    vi.mocked(db.findGuestByEmail).mockResolvedValue(null);
    vi.mocked(db.createGuest).mockResolvedValueOnce(guest1).mockResolvedValueOnce(guest2);

    const result = await GuestListService.bulkAddGuests(
      EVENT_ID,
      USER_ID,
      [
        { name: 'Jane Smith', email: 'jane@example.com', guestType: 'vip', plusCount: 2 },
        { name: 'Bob Smith', email: 'bob@example.com', guestType: 'regular', plusCount: 0 },
      ],
      db,
      kafka
    );

    expect(result.added).toHaveLength(2);
    expect(result.failed).toHaveLength(0);
    expect(result.added[0].id).toBe('g1');
    expect(result.added[1].id).toBe('g2');
  });

  it('5. bulkAddGuests — handles mixed success/failure', async () => {
    const guest1 = { ...MOCK_GUEST, id: 'g1' };

    vi.mocked(db.findGuestByEmail).mockResolvedValueOnce(null).mockResolvedValueOnce(MOCK_GUEST);
    vi.mocked(db.createGuest).mockResolvedValue(guest1);

    const result = await GuestListService.bulkAddGuests(
      EVENT_ID,
      USER_ID,
      [
        { name: 'Jane Smith', email: 'jane@example.com', guestType: 'vip', plusCount: 2 },
        { name: 'Duplicate', email: 'jane@example.com', guestType: 'regular', plusCount: 0 },
      ],
      db,
      kafka
    );

    expect(result.added).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toContain('Duplicate');
  });

  // -------------------------------------------------------------------------
  // 6. confirmAttendance
  // -------------------------------------------------------------------------

  it('6. confirmAttendance — transitions to confirmed', async () => {
    const confirmed = { ...MOCK_GUEST, status: 'confirmed' as const, confirmed_at: new Date() };
    vi.mocked(db.findGuest).mockResolvedValue(MOCK_GUEST);
    vi.mocked(db.updateGuest).mockResolvedValue(confirmed);

    const result = await GuestListService.confirmAttendance(GUEST_ID, db);

    expect(result.status).toBe('confirmed');
    expect(result.confirmed_at).not.toBeNull();
  });

  it('7. confirmAttendance — idempotent when already confirmed', async () => {
    const confirmed = { ...MOCK_GUEST, status: 'confirmed' as const, confirmed_at: new Date() };
    vi.mocked(db.findGuest).mockResolvedValue(confirmed);

    const result = await GuestListService.confirmAttendance(GUEST_ID, db);

    expect(result.status).toBe('confirmed');
    expect(vi.mocked(db.updateGuest)).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 8. checkInGuest
  // -------------------------------------------------------------------------

  it('8. checkInGuest — valid check-in', async () => {
    const confirmed = { ...MOCK_GUEST, status: 'confirmed' as const };
    const checkedIn = { ...confirmed, status: 'checked_in' as const, checked_in_at: new Date(), checked_in_by_staff_id: STAFF_ID };
    vi.mocked(db.findGuest).mockResolvedValue(confirmed);
    vi.mocked(db.withTransaction).mockImplementation(async (fn) => fn(null));
    vi.mocked(db.updateGuest).mockResolvedValue(checkedIn);

    const result = await GuestListService.checkInGuest(GUEST_ID, STAFF_ID, db);

    expect(result.status).toBe('checked_in');
    expect(result.checked_in_by_staff_id).toBe(STAFF_ID);
    expect(vi.mocked(db.withTransaction)).toHaveBeenCalledOnce();
  });

  it('9. checkInGuest — throws when already checked in', async () => {
    const checkedIn = { ...MOCK_GUEST, status: 'checked_in' as const };
    vi.mocked(db.findGuest).mockResolvedValue(checkedIn);

    await expect(
      GuestListService.checkInGuest(GUEST_ID, STAFF_ID, db)
    ).rejects.toThrow(GuestAlreadyCheckedInError);
  });

  // -------------------------------------------------------------------------
  // 10. markNoShow
  // -------------------------------------------------------------------------

  it('10. markNoShow — marks confirmed guest as no-show', async () => {
    const confirmed = { ...MOCK_GUEST, status: 'confirmed' as const };
    const noShow = { ...confirmed, status: 'no_show' as const };
    vi.mocked(db.findGuest).mockResolvedValue(confirmed);
    vi.mocked(db.updateGuest).mockResolvedValue(noShow);

    const result = await GuestListService.markNoShow(GUEST_ID, STAFF_ID, db);

    expect(result.status).toBe('no_show');
  });

  // -------------------------------------------------------------------------
  // 11. removeGuest
  // -------------------------------------------------------------------------

  it('11. removeGuest — cancels by organizer', async () => {
    vi.mocked(db.findGuest).mockResolvedValue(MOCK_GUEST);
    vi.mocked(db.checkOrganizerOwnership).mockResolvedValue(true);
    vi.mocked(db.updateGuest).mockResolvedValue({ ...MOCK_GUEST, status: 'cancelled' as const });

    await GuestListService.removeGuest(GUEST_ID, USER_ID, db);

    expect(vi.mocked(db.updateGuest)).toHaveBeenCalledWith(GUEST_ID, { status: 'cancelled' });
  });

  it('12. removeGuest — cancels by adder', async () => {
    const guestAddedByMe = { ...MOCK_GUEST, added_by_user_id: USER_ID };
    vi.mocked(db.findGuest).mockResolvedValue(guestAddedByMe);
    vi.mocked(db.updateGuest).mockResolvedValue({ ...guestAddedByMe, status: 'cancelled' as const });

    await GuestListService.removeGuest(GUEST_ID, USER_ID, db);

    expect(vi.mocked(db.checkOrganizerOwnership)).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 13. searchGuests
  // -------------------------------------------------------------------------

  it('13. searchGuests — returns filtered results', async () => {
    vi.mocked(db.listGuestsByEvent).mockResolvedValue([MOCK_GUEST]);

    const result = await GuestListService.searchGuests(EVENT_ID, 'Jane', db);

    expect(result.guests).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 14. getEventSummary
  // -------------------------------------------------------------------------

  it('14. getEventSummary — returns counts', async () => {
    vi.mocked(db.getEventSummary).mockResolvedValue(MOCK_SUMMARY);

    const result = await GuestListService.getEventSummary(EVENT_ID, db);

    expect(result.totalInvited).toBe(100);
    expect(result.totalConfirmed).toBe(80);
    expect(result.totalCheckedIn).toBe(60);
    expect(result.totalNoShow).toBe(10);
    expect(result.totalCancelled).toBe(10);
  });

  // -------------------------------------------------------------------------
  // Integration
  // -------------------------------------------------------------------------

  it('15. Full flow: add → confirm → check in → summary', async () => {
    const invited = MOCK_GUEST;
    const confirmed = { ...invited, status: 'confirmed' as const, confirmed_at: new Date() };
    const checkedIn = { ...confirmed, status: 'checked_in' as const, checked_in_at: new Date(), checked_in_by_staff_id: STAFF_ID };

    // Add
    vi.mocked(db.findGuestByEmail).mockResolvedValue(null);
    vi.mocked(db.createGuest).mockResolvedValue(invited);

    const added = await GuestListService.addGuest(
      EVENT_ID,
      USER_ID,
      { name: 'Jane Smith', email: 'jane@example.com', guestType: 'vip', plusCount: 2 },
      db,
      kafka
    );

    expect(added.status).toBe('invited');

    // Confirm
    vi.mocked(db.findGuest).mockResolvedValue(invited);
    vi.mocked(db.updateGuest).mockResolvedValue(confirmed);

    const confirmedGuest = await GuestListService.confirmAttendance(GUEST_ID, db);
    expect(confirmedGuest.status).toBe('confirmed');

    // Check in
    vi.mocked(db.findGuest).mockResolvedValue(confirmed);
    vi.mocked(db.withTransaction).mockImplementation(async (fn) => fn(null));
    vi.mocked(db.updateGuest).mockResolvedValue(checkedIn);

    const finalGuest = await GuestListService.checkInGuest(GUEST_ID, STAFF_ID, db);
    expect(finalGuest.status).toBe('checked_in');

    // Get summary
    vi.mocked(db.getEventSummary).mockResolvedValue(MOCK_SUMMARY);
    const summary = await GuestListService.getEventSummary(EVENT_ID, db);
    expect(summary.totalCheckedIn).toBe(60);
  });
});
