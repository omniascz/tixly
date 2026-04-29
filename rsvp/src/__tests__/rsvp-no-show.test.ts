import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RsvpService } from '../services/rsvp.service';
import type { RsvpDbAdapter, RsvpOrganizerAdapter } from '../services/rsvp.service';
import type { RsvpEntry } from '../types/rsvp.types';
import { RsvpNotApprovedError, RsvpNotFoundError, RsvpUnauthorizedError } from '../types/rsvp.types';

// ---------------------------------------------------------------------------
// Mock adapters
// ---------------------------------------------------------------------------

function makeDb(overrides: Partial<RsvpDbAdapter> = {}): RsvpDbAdapter {
  const db: any = {
    findRsvpById: vi.fn(),
    findRsvpTicketType: vi.fn(),
    findUserRsvpsForEvent: vi.fn(),
    createRsvp: vi.fn(),
    updateRsvpStatus: vi.fn(),
    incrementRsvpCount: vi.fn(),
    decrementRsvpCount: vi.fn(),
    incrementWaitlistCount: vi.fn(),
    decrementWaitlistCount: vi.fn(),
    getNextWaitlisted: vi.fn(),
    issueTicketForRsvp: vi.fn(),
    listRsvpsByTicketType: vi.fn(),
    listRsvpsByUser: vi.fn(),
    listRsvpsByEvent: vi.fn(),
    findRsvpsByEventTimeWindow: vi.fn(),
    findEventForRsvp: vi.fn(),
    updateRsvpReminder: vi.fn(),
    withTransaction: vi.fn(async (fn: any) => fn(db)),
    ...overrides,
  };
  return db;
}

function makeOrganizer(isOwner = true): RsvpOrganizerAdapter {
  return { isOrganizerOfEvent: vi.fn().mockResolvedValue(isOwner) };
}

const APPROVED_RSVP: RsvpEntry = {
  id: 'rsvp-1',
  event_id: 'event-1',
  ticket_type_id: 'tt-1',
  user_id: 'user-1',
  email: 'guest@example.com',
  status: 'approved',
  plus_one: false,
  notes: null,
  organizer_notes: null,
  ticket_id: 'ticket-1',
  created_at: new Date('2026-04-01'),
  updated_at: new Date('2026-04-01'),
  approved_at: new Date('2026-04-02'),
  rejected_at: null,
  reminder_sent_at: null,
  no_show_at: null,
};

// ---------------------------------------------------------------------------
// markNoShow
// ---------------------------------------------------------------------------

describe('RsvpService.markNoShow', () => {
  let db: RsvpDbAdapter;
  let service: RsvpService;

  beforeEach(() => {
    db = makeDb();
    service = new RsvpService(makeOrganizer(true));
  });

  it('transitions approved RSVP to no_show with timestamp', async () => {
    vi.mocked(db.findRsvpById).mockResolvedValue(APPROVED_RSVP);
    vi.mocked(db.updateRsvpStatus).mockImplementation(async (_id, status, data) => ({
      ...APPROVED_RSVP,
      status,
      ...(data as Partial<RsvpEntry>),
    }));

    const result = await service.markNoShow('rsvp-1', 'organizer-1', db);

    expect(result.status).toBe('no_show');
    expect(result.no_show_at).toBeInstanceOf(Date);
    expect(vi.mocked(db.updateRsvpStatus)).toHaveBeenCalledWith(
      'rsvp-1',
      'no_show',
      expect.objectContaining({ no_show_at: expect.any(Date) }),
      expect.anything(),
    );
  });

  it('refuses to mark a pending RSVP as no-show', async () => {
    vi.mocked(db.findRsvpById).mockResolvedValue({ ...APPROVED_RSVP, status: 'pending' });
    await expect(
      service.markNoShow('rsvp-1', 'organizer-1', db),
    ).rejects.toThrow(RsvpNotApprovedError);
  });

  it('refuses to mark a waitlisted RSVP as no-show', async () => {
    vi.mocked(db.findRsvpById).mockResolvedValue({ ...APPROVED_RSVP, status: 'waitlisted' });
    await expect(
      service.markNoShow('rsvp-1', 'organizer-1', db),
    ).rejects.toThrow(RsvpNotApprovedError);
  });

  it('throws RsvpNotFoundError for missing RSVP', async () => {
    vi.mocked(db.findRsvpById).mockResolvedValue(null);
    await expect(
      service.markNoShow('rsvp-missing', 'organizer-1', db),
    ).rejects.toThrow(RsvpNotFoundError);
  });

  it('requires organizer ownership', async () => {
    const nonOwnerService = new RsvpService(makeOrganizer(false));
    vi.mocked(db.findRsvpById).mockResolvedValue(APPROVED_RSVP);
    await expect(
      nonOwnerService.markNoShow('rsvp-1', 'stranger', db),
    ).rejects.toThrow(RsvpUnauthorizedError);
  });
});

// ---------------------------------------------------------------------------
// listRsvpsForEvent — guest list export
// ---------------------------------------------------------------------------

describe('RsvpService.listRsvpsForEvent', () => {
  it('returns rows when organizer owns the event', async () => {
    const db = makeDb();
    const service = new RsvpService(makeOrganizer(true));
    const rows: RsvpEntry[] = [APPROVED_RSVP, { ...APPROVED_RSVP, id: 'rsvp-2', email: 'b@example.com' }];
    vi.mocked(db.listRsvpsByEvent!).mockResolvedValue(rows);

    const result = await service.listRsvpsForEvent('event-1', 'organizer-1', db);

    expect(result).toHaveLength(2);
    expect(vi.mocked(db.listRsvpsByEvent!)).toHaveBeenCalledWith('event-1');
  });

  it('rejects non-organizers', async () => {
    const db = makeDb();
    const service = new RsvpService(makeOrganizer(false));
    await expect(
      service.listRsvpsForEvent('event-1', 'stranger', db),
    ).rejects.toThrow(RsvpUnauthorizedError);
  });

  it('throws if adapter missing listRsvpsByEvent', async () => {
    const db = makeDb({ listRsvpsByEvent: undefined });
    const service = new RsvpService(makeOrganizer(true));
    await expect(
      service.listRsvpsForEvent('event-1', 'organizer-1', db),
    ).rejects.toThrow(/not implemented/);
  });
});
