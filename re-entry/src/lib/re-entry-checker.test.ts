// ---------------------------------------------------------------------------
// Re-entry Checker — Vitest unit tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  getTicketPresence,
  determineEventType,
  checkReentryPolicy,
  buildDenialMessage,
} from './re-entry-checker';
import type { ScanEvent, ReentryPolicy } from '../types/re-entry.types';
import {
  ReentryDeniedError,
  ReentryLimitExceededError,
  ReentryWithoutExitError,
} from '../types/re-entry.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TICKET_ID = 'ticket-001';
const GATE_ID = 'gate-001';
const STAFF_ID = 'staff-001';

function makeScan(
  overrides: Partial<ScanEvent> & { event_type: 'check_in' | 'check_out' }
): ScanEvent {
  return {
    id: `scan-${Math.random().toString(36).slice(2)}`,
    ticket_id: TICKET_ID,
    gate_id: GATE_ID,
    gate_type: 'entry',
    scanned_at: new Date('2026-04-04T18:00:00Z'),
    staff_id: STAFF_ID,
    allowed: true,
    denial_reason: null,
    ...overrides,
  };
}

function makePolicy(overrides: Partial<ReentryPolicy> = {}): ReentryPolicy {
  return {
    id: 'policy-001',
    event_id: 'event-001',
    ticket_type_id: null,
    allowed: true,
    max_reentries: null,
    vip_only: false,
    requires_exit_before_reentry: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getTicketPresence
// ---------------------------------------------------------------------------

describe('getTicketPresence', () => {
  it('returns zeroed state for empty history', () => {
    const presence = getTicketPresence([], TICKET_ID);
    expect(presence.ticket_id).toBe(TICKET_ID);
    expect(presence.is_inside).toBe(false);
    expect(presence.check_in_count).toBe(0);
    expect(presence.check_out_count).toBe(0);
    expect(presence.reentry_count).toBe(0);
    expect(presence.last_scan_at).toBeNull();
    expect(presence.last_event_type).toBeNull();
  });

  it('reflects single check_in', () => {
    const history = [makeScan({ event_type: 'check_in' })];
    const presence = getTicketPresence(history, TICKET_ID);
    expect(presence.is_inside).toBe(true);
    expect(presence.check_in_count).toBe(1);
    expect(presence.check_out_count).toBe(0);
    expect(presence.reentry_count).toBe(0); // first entry is not a re-entry
    expect(presence.last_event_type).toBe('check_in');
  });

  it('reflects check_in → check_out', () => {
    const history = [
      makeScan({ event_type: 'check_in', scanned_at: new Date('2026-04-04T18:00:00Z') }),
      makeScan({ event_type: 'check_out', scanned_at: new Date('2026-04-04T19:00:00Z') }),
    ];
    const presence = getTicketPresence(history, TICKET_ID);
    expect(presence.is_inside).toBe(false);
    expect(presence.check_in_count).toBe(1);
    expect(presence.check_out_count).toBe(1);
    expect(presence.reentry_count).toBe(0);
    expect(presence.last_event_type).toBe('check_out');
  });

  it('reflects full check_in → check_out → re-entry cycle', () => {
    const history = [
      makeScan({ event_type: 'check_in',  scanned_at: new Date('2026-04-04T18:00:00Z') }),
      makeScan({ event_type: 'check_out', scanned_at: new Date('2026-04-04T18:30:00Z') }),
      makeScan({ event_type: 'check_in',  scanned_at: new Date('2026-04-04T19:00:00Z') }),
    ];
    const presence = getTicketPresence(history, TICKET_ID);
    expect(presence.is_inside).toBe(true);
    expect(presence.check_in_count).toBe(2);
    expect(presence.check_out_count).toBe(1);
    expect(presence.reentry_count).toBe(1);
    expect(presence.last_event_type).toBe('check_in');
  });

  it('ignores denied scans when computing presence', () => {
    const history = [
      makeScan({ event_type: 'check_in', allowed: true }),
      makeScan({ event_type: 'check_in', allowed: false, denial_reason: 'denied' }),
    ];
    const presence = getTicketPresence(history, TICKET_ID);
    expect(presence.check_in_count).toBe(1);
    expect(presence.reentry_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// determineEventType
// ---------------------------------------------------------------------------

describe('determineEventType', () => {
  const outsidePresence = getTicketPresence([], TICKET_ID);
  const insidePresence = getTicketPresence(
    [makeScan({ event_type: 'check_in' })],
    TICKET_ID
  );
  const exitedPresence = getTicketPresence(
    [
      makeScan({ event_type: 'check_in',  scanned_at: new Date('2026-04-04T18:00:00Z') }),
      makeScan({ event_type: 'check_out', scanned_at: new Date('2026-04-04T19:00:00Z') }),
    ],
    TICKET_ID
  );

  it('EXIT gate always returns check_out (when inside)', () => {
    expect(determineEventType('exit', insidePresence)).toBe('check_out');
  });

  it('EXIT gate always returns check_out (even when outside)', () => {
    expect(determineEventType('exit', outsidePresence)).toBe('check_out');
  });

  it('ENTRY gate + first visit → check_in', () => {
    expect(determineEventType('entry', outsidePresence)).toBe('check_in');
  });

  it('ENTRY gate + exited → reentry', () => {
    expect(determineEventType('entry', exitedPresence)).toBe('reentry');
  });

  it('ENTRY gate + currently inside → reentry (will be blocked by policy)', () => {
    expect(determineEventType('entry', insidePresence)).toBe('reentry');
  });

  it('BIDIRECTIONAL gate + inside → check_out', () => {
    expect(determineEventType('bidirectional', insidePresence)).toBe('check_out');
  });

  it('BIDIRECTIONAL gate + first visit → check_in', () => {
    expect(determineEventType('bidirectional', outsidePresence)).toBe('check_in');
  });

  it('BIDIRECTIONAL gate + has been inside + currently outside → reentry', () => {
    expect(determineEventType('bidirectional', exitedPresence)).toBe('reentry');
  });
});

// ---------------------------------------------------------------------------
// checkReentryPolicy
// ---------------------------------------------------------------------------

describe('checkReentryPolicy', () => {
  const freshPresence = getTicketPresence([], TICKET_ID);
  const exitedPresence = getTicketPresence(
    [
      makeScan({ event_type: 'check_in',  scanned_at: new Date('2026-04-04T18:00:00Z') }),
      makeScan({ event_type: 'check_out', scanned_at: new Date('2026-04-04T19:00:00Z') }),
    ],
    TICKET_ID
  );
  const insidePresence = getTicketPresence(
    [makeScan({ event_type: 'check_in' })],
    TICKET_ID
  );

  it('throws ReentryDeniedError when policy.allowed = false', () => {
    const policy = makePolicy({ allowed: false });
    expect(() => checkReentryPolicy(policy, exitedPresence, false)).toThrow(
      ReentryDeniedError
    );
  });

  it('throws ReentryDeniedError for vip_only policy and non-VIP ticket', () => {
    const policy = makePolicy({ vip_only: true });
    expect(() => checkReentryPolicy(policy, exitedPresence, false)).toThrow(
      ReentryDeniedError
    );
  });

  it('allows reentry for vip_only policy when ticket is VIP', () => {
    const policy = makePolicy({ vip_only: true });
    const result = checkReentryPolicy(policy, exitedPresence, true);
    expect(result.allowed).toBe(true);
  });

  it('allows reentry for non-VIP when vip_only = false', () => {
    const policy = makePolicy({ vip_only: false });
    const result = checkReentryPolicy(policy, exitedPresence, false);
    expect(result.allowed).toBe(true);
  });

  it('throws ReentryLimitExceededError when reentry_count equals max_reentries', () => {
    const history = [
      makeScan({ event_type: 'check_in',  scanned_at: new Date('2026-04-04T17:00:00Z') }),
      makeScan({ event_type: 'check_out', scanned_at: new Date('2026-04-04T17:30:00Z') }),
      makeScan({ event_type: 'check_in',  scanned_at: new Date('2026-04-04T18:00:00Z') }),
      makeScan({ event_type: 'check_out', scanned_at: new Date('2026-04-04T18:30:00Z') }),
    ];
    const presence = getTicketPresence(history, TICKET_ID); // reentry_count = 1
    const policy = makePolicy({ max_reentries: 1 });
    expect(() => checkReentryPolicy(policy, presence, false)).toThrow(
      ReentryLimitExceededError
    );
  });

  it('allows reentry when reentry_count is below max_reentries', () => {
    const policy = makePolicy({ max_reentries: 3 });
    const result = checkReentryPolicy(policy, exitedPresence, false); // reentry_count = 0
    expect(result.allowed).toBe(true);
  });

  it('allows unlimited reentry when max_reentries = null', () => {
    const policy = makePolicy({ max_reentries: null });
    const result = checkReentryPolicy(policy, exitedPresence, false);
    expect(result.allowed).toBe(true);
    expect(result.max_reentries).toBeNull();
  });

  it('throws ReentryWithoutExitError when requires_exit_before_reentry and guest is inside', () => {
    const policy = makePolicy({ requires_exit_before_reentry: true });
    expect(() => checkReentryPolicy(policy, insidePresence, false)).toThrow(
      ReentryWithoutExitError
    );
  });

  it('allows reentry with requires_exit_before_reentry when guest has exited', () => {
    const policy = makePolicy({ requires_exit_before_reentry: true });
    const result = checkReentryPolicy(policy, exitedPresence, false);
    expect(result.allowed).toBe(true);
  });

  it('returns correct reentry_count and max_reentries in result', () => {
    const history = [
      makeScan({ event_type: 'check_in',  scanned_at: new Date('2026-04-04T17:00:00Z') }),
      makeScan({ event_type: 'check_out', scanned_at: new Date('2026-04-04T17:30:00Z') }),
      makeScan({ event_type: 'check_in',  scanned_at: new Date('2026-04-04T18:00:00Z') }),
      makeScan({ event_type: 'check_out', scanned_at: new Date('2026-04-04T18:30:00Z') }),
    ];
    const presence = getTicketPresence(history, TICKET_ID); // reentry_count = 1
    const policy = makePolicy({ max_reentries: 3 });
    const result = checkReentryPolicy(policy, presence, false);
    expect(result.reentry_count).toBe(1);
    expect(result.max_reentries).toBe(3);
  });

  it('freshPresence + open policy → allowed, reentry_count = 0', () => {
    const policy = makePolicy();
    const result = checkReentryPolicy(policy, freshPresence, false);
    expect(result.allowed).toBe(true);
    expect(result.reentry_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildDenialMessage
// ---------------------------------------------------------------------------

describe('buildDenialMessage', () => {
  it('returns Czech message for reentry_denied', () => {
    const msg = buildDenialMessage('reentry_denied', 'cs');
    expect(msg).toBeTruthy();
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
  });

  it('returns English message for reentry_denied', () => {
    const msg = buildDenialMessage('reentry_denied', 'en');
    expect(msg).toContain('not permitted');
  });

  it('returns Czech message for reentry_vip_only', () => {
    const msg = buildDenialMessage('reentry_vip_only', 'cs');
    expect(msg).toContain('VIP');
  });

  it('returns English message for reentry_vip_only', () => {
    const msg = buildDenialMessage('reentry_vip_only', 'en');
    expect(msg).toContain('VIP');
  });

  it('returns Czech message for reentry_limit_exceeded', () => {
    const msg = buildDenialMessage('reentry_limit_exceeded', 'cs');
    expect(msg).toBeTruthy();
  });

  it('returns English message for reentry_without_exit', () => {
    const msg = buildDenialMessage('reentry_without_exit', 'en');
    expect(msg).toContain('exit');
  });

  it('returns fallback for unknown reason code in CS', () => {
    const msg = buildDenialMessage('totally_unknown_code', 'cs');
    expect(msg).toBeTruthy();
    expect(typeof msg).toBe('string');
  });

  it('returns fallback for unknown reason code in EN', () => {
    const msg = buildDenialMessage('totally_unknown_code', 'en');
    expect(msg).toBeTruthy();
  });
});
