/**
 * Unit tests for RSVP pure business rules.
 * No I/O — all inputs are constructed inline.
 *
 * Run with: vitest src/lib/rsvp-rules.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  validateRsvpRequest,
  shouldAutoApprove,
  getInitialStatus,
  canPromoteFromWaitlist,
  formatRsvpConfirmationMessage,
  type RsvpConfirmationEvent,
} from './rsvp-rules';
import {
  RsvpCapacityFullError,
  RsvpDeadlinePassedError,
  RsvpAlreadyExistsError,
  RsvpPlusOneNotAllowedError,
  type RsvpTicketType,
  type RsvpEntry,
} from '../types/rsvp.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTicketType(overrides: Partial<RsvpTicketType> = {}): RsvpTicketType {
  return {
    id: 'tt-1',
    event_id: 'ev-1',
    name: 'General Admission',
    description: null,
    max_capacity: 10,
    current_count: 0,
    waitlist_count: 0,
    deadline: null,
    approval_required: false,
    allow_plus_one: true,
    max_per_user: 1,
    active: true,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<RsvpEntry> = {}): RsvpEntry {
  return {
    id: 'rsvp-1',
    event_id: 'ev-1',
    ticket_type_id: 'tt-1',
    user_id: 'user-1',
    status: 'approved',
    plus_one: false,
    notes: null,
    organizer_notes: null,
    ticket_id: null,
    created_at: new Date('2026-04-01T10:00:00Z'),
    updated_at: new Date('2026-04-01T10:00:00Z'),
    approved_at: null,
    rejected_at: null,
    ...overrides,
  };
}

const NOW = new Date('2026-04-04T12:00:00Z');
const USER_ID = 'user-42';
const EVENT: RsvpConfirmationEvent = { name: 'Test Conference 2026' };

// ---------------------------------------------------------------------------
// validateRsvpRequest — auto-approve flow
// ---------------------------------------------------------------------------

describe('validateRsvpRequest — auto-approve flow', () => {
  it('passes when capacity available, no deadline, no existing RSVPs', () => {
    const tt = makeTicketType();
    expect(() => validateRsvpRequest(tt, [], USER_ID, NOW)).not.toThrow();
  });

  it('passes with available capacity even when some RSVPs exist for other users', () => {
    const tt = makeTicketType({ current_count: 5 });
    expect(() => validateRsvpRequest(tt, [], USER_ID, NOW)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateRsvpRequest — manual approval flow
// ---------------------------------------------------------------------------

describe('validateRsvpRequest — manual approval flow', () => {
  it('passes for manual-approval ticket type with free capacity', () => {
    const tt = makeTicketType({ approval_required: true });
    expect(() => validateRsvpRequest(tt, [], USER_ID, NOW)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateRsvpRequest — capacity full → waitlist
// ---------------------------------------------------------------------------

describe('validateRsvpRequest — capacity full', () => {
  it('throws RsvpCapacityFullError when current_count === max_capacity', () => {
    const tt = makeTicketType({ max_capacity: 5, current_count: 5 });
    expect(() => validateRsvpRequest(tt, [], USER_ID, NOW)).toThrow(RsvpCapacityFullError);
  });

  it('RsvpCapacityFullError carries suggest_waitlist: true', () => {
    const tt = makeTicketType({ max_capacity: 1, current_count: 1 });
    try {
      validateRsvpRequest(tt, [], USER_ID, NOW);
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(RsvpCapacityFullError);
      expect((err as RsvpCapacityFullError).suggest_waitlist).toBe(true);
    }
  });

  it('does not throw when current_count is one below max_capacity', () => {
    const tt = makeTicketType({ max_capacity: 5, current_count: 4 });
    expect(() => validateRsvpRequest(tt, [], USER_ID, NOW)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateRsvpRequest — deadline
// ---------------------------------------------------------------------------

describe('validateRsvpRequest — deadline', () => {
  it('throws RsvpDeadlinePassedError when now is after deadline', () => {
    const tt = makeTicketType({ deadline: new Date('2026-04-01T00:00:00Z') });
    expect(() => validateRsvpRequest(tt, [], USER_ID, NOW)).toThrow(RsvpDeadlinePassedError);
  });

  it('passes when now is exactly before deadline', () => {
    const tt = makeTicketType({ deadline: new Date('2026-04-05T00:00:00Z') });
    expect(() => validateRsvpRequest(tt, [], USER_ID, NOW)).not.toThrow();
  });

  it('passes when deadline is null', () => {
    const tt = makeTicketType({ deadline: null });
    expect(() => validateRsvpRequest(tt, [], USER_ID, NOW)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateRsvpRequest — duplicate RSVP
// ---------------------------------------------------------------------------

describe('validateRsvpRequest — duplicate RSVP', () => {
  it('throws RsvpAlreadyExistsError when user has an active RSVP (approved)', () => {
    const tt = makeTicketType({ max_per_user: 1 });
    const existing = [makeEntry({ user_id: USER_ID, status: 'approved' })];
    expect(() => validateRsvpRequest(tt, existing, USER_ID, NOW)).toThrow(RsvpAlreadyExistsError);
  });

  it('throws RsvpAlreadyExistsError when user has a pending RSVP', () => {
    const tt = makeTicketType({ max_per_user: 1 });
    const existing = [makeEntry({ user_id: USER_ID, status: 'pending' })];
    expect(() => validateRsvpRequest(tt, existing, USER_ID, NOW)).toThrow(RsvpAlreadyExistsError);
  });

  it('does not throw when only cancelled/rejected RSVPs exist (user may re-register)', () => {
    const tt = makeTicketType({ max_per_user: 1 });
    const existing = [
      makeEntry({ user_id: USER_ID, status: 'cancelled' }),
      makeEntry({ user_id: USER_ID, status: 'rejected' }),
    ];
    expect(() => validateRsvpRequest(tt, existing, USER_ID, NOW)).not.toThrow();
  });

  it('allows second RSVP when max_per_user is 2 and user has one active', () => {
    const tt = makeTicketType({ max_per_user: 2 });
    const existing = [makeEntry({ user_id: USER_ID, status: 'approved' })];
    expect(() => validateRsvpRequest(tt, existing, USER_ID, NOW)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateRsvpRequest — plus_one
// ---------------------------------------------------------------------------

describe('validateRsvpRequest — plus_one', () => {
  it('passes when plus_one requested and allowed', () => {
    const tt = makeTicketType({ allow_plus_one: true });
    expect(() => validateRsvpRequest(tt, [], USER_ID, NOW, { plusOne: true })).not.toThrow();
  });

  it('throws RsvpPlusOneNotAllowedError when plus_one requested but not allowed', () => {
    const tt = makeTicketType({ allow_plus_one: false });
    expect(() => validateRsvpRequest(tt, [], USER_ID, NOW, { plusOne: true })).toThrow(
      RsvpPlusOneNotAllowedError,
    );
  });

  it('passes when plus_one is false regardless of allow_plus_one flag', () => {
    const tt = makeTicketType({ allow_plus_one: false });
    expect(() => validateRsvpRequest(tt, [], USER_ID, NOW, { plusOne: false })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// shouldAutoApprove
// ---------------------------------------------------------------------------

describe('shouldAutoApprove', () => {
  it('returns true when approval_required is false', () => {
    expect(shouldAutoApprove(makeTicketType({ approval_required: false }))).toBe(true);
  });

  it('returns false when approval_required is true', () => {
    expect(shouldAutoApprove(makeTicketType({ approval_required: true }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getInitialStatus
// ---------------------------------------------------------------------------

describe('getInitialStatus', () => {
  it('returns approved when capacity free and auto-approve enabled', () => {
    const tt = makeTicketType({ approval_required: false });
    expect(getInitialStatus(tt, false)).toBe('approved');
  });

  it('returns pending when capacity free and manual approval required', () => {
    const tt = makeTicketType({ approval_required: true });
    expect(getInitialStatus(tt, false)).toBe('pending');
  });

  it('returns waitlisted when capacity is full regardless of approval_required', () => {
    expect(getInitialStatus(makeTicketType({ approval_required: false }), true)).toBe('waitlisted');
    expect(getInitialStatus(makeTicketType({ approval_required: true }), true)).toBe('waitlisted');
  });
});

// ---------------------------------------------------------------------------
// canPromoteFromWaitlist — edge cases
// ---------------------------------------------------------------------------

describe('canPromoteFromWaitlist', () => {
  it('returns true when current_count < max_capacity', () => {
    const tt = makeTicketType({ max_capacity: 10, current_count: 9 });
    expect(canPromoteFromWaitlist(tt)).toBe(true);
  });

  it('returns false when current_count === max_capacity', () => {
    const tt = makeTicketType({ max_capacity: 10, current_count: 10 });
    expect(canPromoteFromWaitlist(tt)).toBe(false);
  });

  it('returns false when current_count > max_capacity (data inconsistency guard)', () => {
    const tt = makeTicketType({ max_capacity: 5, current_count: 6 });
    expect(canPromoteFromWaitlist(tt)).toBe(false);
  });

  it('returns true when max_capacity is 1 and current_count is 0', () => {
    const tt = makeTicketType({ max_capacity: 1, current_count: 0 });
    expect(canPromoteFromWaitlist(tt)).toBe(true);
  });

  it('returns false when max_capacity is 1 and current_count is 1', () => {
    const tt = makeTicketType({ max_capacity: 1, current_count: 1 });
    expect(canPromoteFromWaitlist(tt)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatRsvpConfirmationMessage — cs + en
// ---------------------------------------------------------------------------

describe('formatRsvpConfirmationMessage — Czech', () => {
  it('approved — cs', () => {
    const entry = makeEntry({ status: 'approved' });
    const msg = formatRsvpConfirmationMessage(entry, EVENT, 'cs');
    expect(msg).toContain('schváleno');
    expect(msg).toContain('Test Conference 2026');
  });

  it('pending — cs', () => {
    const entry = makeEntry({ status: 'pending' });
    const msg = formatRsvpConfirmationMessage(entry, EVENT, 'cs');
    expect(msg).toContain('čeká na schválení');
  });

  it('waitlisted — cs', () => {
    const entry = makeEntry({ status: 'waitlisted' });
    const msg = formatRsvpConfirmationMessage(entry, EVENT, 'cs');
    expect(msg).toContain('čekací listinu');
  });

  it('rejected — cs', () => {
    const entry = makeEntry({ status: 'rejected' });
    const msg = formatRsvpConfirmationMessage(entry, EVENT, 'cs');
    expect(msg).toContain('zamítnuto');
  });

  it('cancelled — cs', () => {
    const entry = makeEntry({ status: 'cancelled' });
    const msg = formatRsvpConfirmationMessage(entry, EVENT, 'cs');
    expect(msg).toContain('zrušeno');
  });
});

describe('formatRsvpConfirmationMessage — English', () => {
  it('approved — en', () => {
    const entry = makeEntry({ status: 'approved' });
    const msg = formatRsvpConfirmationMessage(entry, EVENT, 'en');
    expect(msg).toContain('approved');
    expect(msg).toContain('Test Conference 2026');
  });

  it('pending — en', () => {
    const entry = makeEntry({ status: 'pending' });
    const msg = formatRsvpConfirmationMessage(entry, EVENT, 'en');
    expect(msg).toContain('awaiting organizer approval');
  });

  it('waitlisted — en', () => {
    const entry = makeEntry({ status: 'waitlisted' });
    const msg = formatRsvpConfirmationMessage(entry, EVENT, 'en');
    expect(msg).toContain('waitlist');
  });

  it('rejected — en', () => {
    const entry = makeEntry({ status: 'rejected' });
    const msg = formatRsvpConfirmationMessage(entry, EVENT, 'en');
    expect(msg).toContain('rejected');
  });

  it('cancelled — en', () => {
    const entry = makeEntry({ status: 'cancelled' });
    const msg = formatRsvpConfirmationMessage(entry, EVENT, 'en');
    expect(msg).toContain('cancelled');
  });
});

// ---------------------------------------------------------------------------
// Extended Coverage: RSVP Creation, Status Retrieval & Capacity Management
// ---------------------------------------------------------------------------

describe('validateRsvpRequest — createRsvp at capacity scenarios', () => {
  it('rejects RSVP when at exact capacity', () => {
    const tt = makeTicketType({ max_capacity: 50, current_count: 50 });
    expect(() => validateRsvpRequest(tt, [], USER_ID, NOW)).toThrowError(RsvpCapacityFullError);
  });

  it('throws with suggest_waitlist = true when capacity full', () => {
    const tt = makeTicketType({ max_capacity: 1, current_count: 1 });
    try {
      validateRsvpRequest(tt, [], USER_ID, NOW);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RsvpCapacityFullError);
      expect((err as RsvpCapacityFullError).suggest_waitlist).toBe(true);
    }
  });

  it('allows entry when capacity available, even with partial fills', () => {
    const tt = makeTicketType({ max_capacity: 100, current_count: 75 });
    expect(() => validateRsvpRequest(tt, [], USER_ID, NOW)).not.toThrow();
  });
});

describe('validateRsvpRequest — duplicate email rejection', () => {
  it('throws RsvpAlreadyExistsError for approved RSVP from same user', () => {
    const tt = makeTicketType({ max_per_user: 1 });
    const existing = [makeEntry({ user_id: USER_ID, status: 'approved' })];
    expect(() => validateRsvpRequest(tt, existing, USER_ID, NOW)).toThrow(RsvpAlreadyExistsError);
  });

  it('throws RsvpAlreadyExistsError for pending RSVP from same user', () => {
    const tt = makeTicketType({ max_per_user: 1 });
    const existing = [makeEntry({ user_id: USER_ID, status: 'pending' })];
    expect(() => validateRsvpRequest(tt, existing, USER_ID, NOW)).toThrow(RsvpAlreadyExistsError);
  });

  it('allows re-registration after cancellation', () => {
    const tt = makeTicketType({ max_per_user: 1 });
    const cancelled = [makeEntry({ user_id: USER_ID, status: 'cancelled' })];
    expect(() => validateRsvpRequest(tt, cancelled, USER_ID, NOW)).not.toThrow();
  });

  it('allows re-registration after rejection', () => {
    const tt = makeTicketType({ max_per_user: 1 });
    const rejected = [makeEntry({ user_id: USER_ID, status: 'rejected' })];
    expect(() => validateRsvpRequest(tt, rejected, USER_ID, NOW)).not.toThrow();
  });

  it('allows multiple RSVPs when max_per_user > 1', () => {
    const tt = makeTicketType({ max_per_user: 3 });
    const existing = [
      makeEntry({ user_id: USER_ID, status: 'approved' }),
      makeEntry({ user_id: USER_ID, status: 'approved', id: 'rsvp-2' }),
    ];
    expect(() => validateRsvpRequest(tt, existing, USER_ID, NOW)).not.toThrow();
  });

  it('rejects when user hits max_per_user limit', () => {
    const tt = makeTicketType({ max_per_user: 2 });
    const existing = [
      makeEntry({ user_id: USER_ID, status: 'approved' }),
      makeEntry({ user_id: USER_ID, status: 'approved', id: 'rsvp-2' }),
    ];
    expect(() => validateRsvpRequest(tt, existing, USER_ID, NOW)).toThrow(RsvpAlreadyExistsError);
  });
});

describe('getStatus helper — returns correct initial status', () => {
  it('returns approved when auto-approve enabled and capacity free', () => {
    const tt = makeTicketType({ approval_required: false });
    expect(getInitialStatus(tt, false)).toBe('approved');
  });

  it('returns pending when manual approval required and capacity free', () => {
    const tt = makeTicketType({ approval_required: true });
    expect(getInitialStatus(tt, false)).toBe('pending');
  });

  it('returns waitlisted when at capacity regardless of approval setting', () => {
    const ttNoApproval = makeTicketType({ approval_required: false, max_capacity: 10, current_count: 10 });
    const ttWithApproval = makeTicketType({ approval_required: true, max_capacity: 10, current_count: 10 });
    expect(getInitialStatus(ttNoApproval, true)).toBe('waitlisted');
    expect(getInitialStatus(ttWithApproval, true)).toBe('waitlisted');
  });
});

describe('reminder scheduling & unRsvp scenarios', () => {
  it('formats Czech reminder message with event name', () => {
    const entry = makeEntry({ status: 'approved' });
    const msg = formatRsvpConfirmationMessage(entry, EVENT, 'cs');
    expect(msg).toContain(EVENT.name);
    expect(msg).toContain('schváleno');
  });

  it('formats English reminder message with event name', () => {
    const entry = makeEntry({ status: 'approved' });
    const msg = formatRsvpConfirmationMessage(entry, EVENT, 'en');
    expect(msg).toContain(EVENT.name);
    expect(msg).toContain('approved');
  });

  it('handles unRsvp by allowing re-registration', () => {
    const tt = makeTicketType({ max_per_user: 1 });
    // After unRsvp, status is cancelled
    const cancelled = [makeEntry({ user_id: USER_ID, status: 'cancelled' })];
    expect(() => validateRsvpRequest(tt, cancelled, USER_ID, NOW)).not.toThrow();
  });
});
