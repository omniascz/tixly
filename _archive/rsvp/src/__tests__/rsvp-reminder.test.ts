/**
 * Unit tests for RSVP reminder job.
 * Run with: vitest src/__tests__/rsvp-reminder.test.ts
 */
import { describe, it, expect, vi } from 'vitest';
import { sendRsvpReminders } from '../jobs/rsvp-reminder.job.js';
import type { ReminderJobDeps } from '../jobs/rsvp-reminder.job.js';
import type { RsvpEntry } from '../types/rsvp.types.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeRsvp(overrides: Partial<RsvpEntry> = {}): RsvpEntry {
  return {
    id: 'rsvp-1',
    event_id: 'ev-1',
    ticket_type_id: 'tt-1',
    user_id: 'user-1',
    email: 'user@example.com',
    status: 'approved',
    plus_one: false,
    notes: null,
    organizer_notes: null,
    ticket_id: 'ticket-1',
    created_at: new Date('2026-04-01T10:00:00Z'),
    updated_at: new Date('2026-04-01T10:00:00Z'),
    approved_at: new Date('2026-04-01T10:00:00Z'),
    rejected_at: null,
    reminder_sent_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('sendRsvpReminders', () => {
  it('returns { sent: 0, failed: 0 } when no RSVPs found', async () => {
    const deps: ReminderJobDeps = {
      db: {
        findRsvpsByEventTimeWindow: vi.fn().mockResolvedValue([]),
      } as any,
      email: {
        send: vi.fn(),
      } as any,
    };

    const result = await sendRsvpReminders(deps, 24);

    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(deps.db.findRsvpsByEventTimeWindow).toHaveBeenCalled();
  });

  it('skips RSVPs that already have reminder_sent_at set', async () => {
    const rsvp = makeRsvp({
      reminder_sent_at: new Date('2026-04-07T12:00:00Z'),
    });

    const deps: ReminderJobDeps = {
      db: {
        findRsvpsByEventTimeWindow: vi.fn().mockResolvedValue([rsvp]),
      } as any,
      email: {
        send: vi.fn(),
      } as any,
    };

    const result = await sendRsvpReminders(deps, 24);

    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(deps.email.send).not.toHaveBeenCalled();
  });

  it('sends reminder email for pending RSVPs', async () => {
    const rsvp = makeRsvp({ email: 'attendee@example.com' });

    const deps: ReminderJobDeps = {
      db: {
        findRsvpsByEventTimeWindow: vi.fn().mockResolvedValue([rsvp]),
        findRsvpTicketType: vi.fn().mockResolvedValue({
          id: 'tt-1',
          name: 'General Admission',
        }),
        findEventForRsvp: vi.fn().mockResolvedValue({
          id: 'ev-1',
          name: 'Test Conference 2026',
        }),
        updateRsvpReminder: vi.fn().mockResolvedValue(undefined),
      } as any,
      email: {
        send: vi.fn().mockResolvedValue(undefined),
      } as any,
    };

    const result = await sendRsvpReminders(deps, 24);

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(deps.email.send).toHaveBeenCalledWith(
      'attendee@example.com',
      'Připomínka: Test Conference 2026',
      expect.stringContaining('Připomínka: akce <strong>Test Conference 2026</strong> se koná zítra.'),
    );
    expect(deps.db.updateRsvpReminder).toHaveBeenCalledWith('rsvp-1', expect.any(Date));
  });

  it('increments failed count when email service throws', async () => {
    const rsvp = makeRsvp();

    const deps: ReminderJobDeps = {
      db: {
        findRsvpsByEventTimeWindow: vi.fn().mockResolvedValue([rsvp]),
        findRsvpTicketType: vi.fn().mockResolvedValue({
          id: 'tt-1',
          name: 'General Admission',
        }),
        findEventForRsvp: vi.fn().mockResolvedValue({
          id: 'ev-1',
          name: 'Test Conference 2026',
        }),
      } as any,
      email: {
        send: vi.fn().mockRejectedValue(new Error('SMTP error')),
      } as any,
    };

    const result = await sendRsvpReminders(deps, 24);

    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(deps.db.updateRsvpReminder).not.toHaveBeenCalled();
  });

  it('increments failed count when ticket type not found', async () => {
    const rsvp = makeRsvp();

    const deps: ReminderJobDeps = {
      db: {
        findRsvpsByEventTimeWindow: vi.fn().mockResolvedValue([rsvp]),
        findRsvpTicketType: vi.fn().mockResolvedValue(null),
      } as any,
      email: {
        send: vi.fn(),
      } as any,
    };

    const result = await sendRsvpReminders(deps, 24);

    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(deps.email.send).not.toHaveBeenCalled();
  });

  it('increments failed count when event not found', async () => {
    const rsvp = makeRsvp();

    const deps: ReminderJobDeps = {
      db: {
        findRsvpsByEventTimeWindow: vi.fn().mockResolvedValue([rsvp]),
        findRsvpTicketType: vi.fn().mockResolvedValue({
          id: 'tt-1',
          name: 'General Admission',
        }),
        findEventForRsvp: vi.fn().mockResolvedValue(null),
      } as any,
      email: {
        send: vi.fn(),
      } as any,
    };

    const result = await sendRsvpReminders(deps, 24);

    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(deps.email.send).not.toHaveBeenCalled();
  });

  it('handles multiple RSVPs with mixed success/failure', async () => {
    const rsvp1 = makeRsvp({ id: 'rsvp-1', email: 'user1@example.com' });
    const rsvp2 = makeRsvp({ id: 'rsvp-2', email: 'user2@example.com' });
    const rsvp3 = makeRsvp({
      id: 'rsvp-3',
      email: 'user3@example.com',
      reminder_sent_at: new Date(), // Already sent
    });

    const deps: ReminderJobDeps = {
      db: {
        findRsvpsByEventTimeWindow: vi.fn().mockResolvedValue([rsvp1, rsvp2, rsvp3]),
        findRsvpTicketType: vi.fn().mockResolvedValue({
          id: 'tt-1',
          name: 'General Admission',
        }),
        findEventForRsvp: vi
          .fn()
          .mockResolvedValueOnce({ id: 'ev-1', name: 'Event 1' })
          .mockResolvedValueOnce(null), // Event not found for rsvp2
        updateRsvpReminder: vi.fn().mockResolvedValue(undefined),
      } as any,
      email: {
        send: vi.fn().mockResolvedValue(undefined),
      } as any,
    };

    const result = await sendRsvpReminders(deps, 24);

    expect(result).toEqual({ sent: 1, failed: 1 });
    expect(deps.email.send).toHaveBeenCalledTimes(1);
    expect(deps.db.updateRsvpReminder).toHaveBeenCalledTimes(1);
  });

  it('respects hoursBeforeEvent parameter for time window', async () => {
    const deps: ReminderJobDeps = {
      db: {
        findRsvpsByEventTimeWindow: vi.fn().mockResolvedValue([]),
      } as any,
      email: {
        send: vi.fn(),
      } as any,
    };

    await sendRsvpReminders(deps, 48);

    const calls = (deps.db.findRsvpsByEventTimeWindow as any).mock.calls;
    expect(calls).toHaveLength(1);
    const [windowStart, windowEnd] = calls[0];

    // Window should be approximately [now+47h, now+49h]
    const now = new Date();
    const expected47h = new Date(now.getTime() + 47 * 60 * 60 * 1000);
    const expected49h = new Date(now.getTime() + 49 * 60 * 60 * 1000);

    expect(windowStart.getTime()).toBeGreaterThan(expected47h.getTime() - 1000);
    expect(windowEnd.getTime()).toBeLessThan(expected49h.getTime() + 1000);
  });
});
