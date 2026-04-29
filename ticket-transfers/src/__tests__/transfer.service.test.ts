import { describe, it, expect, vi } from 'vitest';
import {
  setTransferDeadline,
  isTransferAllowed,
  enforceTransferDeadline,
  logTransferAttempt,
  markTransferCompleted,
  getTransferDeadline,
  disableTransfers,
  enableTransfers,
} from '../services/transfer.service.js';
import type { DbAdapter } from '../services/transfer.service.js';

const EVENT_ID = 'event-001';
const PROMOTER_ID = 'promoter-001';
const TICKET_ID = 'ticket-001';
const TICKET_TYPE_ID = 'tt-001';
const USER_ID = 'user-001';

function makeTransferDeadlineRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'deadline-001',
    event_id: EVENT_ID,
    promoter_id: PROMOTER_ID,
    ticket_type_id: TICKET_TYPE_ID,
    days_before_event: 7,
    deadline_datetime: null,
    allow_transfers: true,
    created_at: '2026-04-14T10:00:00Z',
    updated_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeTransferLogRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'log-001',
    ticket_id: TICKET_ID,
    event_id: EVENT_ID,
    from_user_id: USER_ID,
    to_user_id: 'user-002',
    transfer_status: 'completed',
    transfer_error: null,
    attempted_at: '2026-04-14T10:00:00Z',
    completed_at: '2026-04-14T10:05:00Z',
    ...overrides,
  };
}

function makeDb(queryResults: unknown[][] = [], executeMock = vi.fn()): DbAdapter {
  let callIdx = 0;
  return {
    query: vi.fn(async () => {
      const result = queryResults[callIdx] ?? [];
      callIdx++;
      return result;
    }),
    execute: executeMock,
    transaction: vi.fn(async (fn) => fn({
      query: vi.fn().mockResolvedValue([]),
      execute: executeMock,
      transaction: vi.fn(),
    } as DbAdapter)),
  };
}

describe('setTransferDeadline', () => {
  it('nastaví transfer deadline (7 dní před akcí)', async () => {
    const db = makeDb([[makeTransferDeadlineRow()]]);

    const result = await setTransferDeadline(EVENT_ID, PROMOTER_ID, 7, TICKET_TYPE_ID, db);

    expect(result.daysBeforeEvent).toBe(7);
    expect(result.allowTransfers).toBe(true);
  });

  it('vyhodí VALIDATION_ERROR pokud dnyBeforeEvent < 1', async () => {
    const db = makeDb([]);

    await expect(
      setTransferDeadline(EVENT_ID, PROMOTER_ID, 0, TICKET_TYPE_ID, db),
    ).rejects.toThrow('VALIDATION_ERROR');
  });

  it('vyhodí VALIDATION_ERROR pokud dnyBeforeEvent > 31', async () => {
    const db = makeDb([]);

    await expect(
      setTransferDeadline(EVENT_ID, PROMOTER_ID, 32, TICKET_TYPE_ID, db),
    ).rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('isTransferAllowed', () => {
  it('vrátí true pokud je transfer povolen', async () => {
    const now = new Date();
    const eventDate = new Date(now);
    eventDate.setDate(eventDate.getDate() + 10);  // Event is 10 days away

    const db = makeDb([
      [{ ticket_type_id: TICKET_TYPE_ID }],  // ticket query
      [{ date: eventDate.toISOString() }],  // event query
      [makeTransferDeadlineRow({ days_before_event: 7 })],  // deadline query (7 days before)
    ]);

    const result = await isTransferAllowed(TICKET_ID, EVENT_ID, db);

    expect(result.allowed).toBe(true);
  });

  it('vrátí false pokud je deadline překročen', async () => {
    const now = new Date();
    const eventDate = new Date(now);
    eventDate.setDate(eventDate.getDate() + 5);  // Event is 5 days away

    const db = makeDb([
      [{ ticket_type_id: TICKET_TYPE_ID }],
      [{ date: eventDate.toISOString() }],
      [makeTransferDeadlineRow({ days_before_event: 7 })],  // Deadline was 2 days ago
    ]);

    const result = await isTransferAllowed(TICKET_ID, EVENT_ID, db);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('DEADLINE_PASSED');
  });

  it('vrátí false pokud jsou transfery zakázány', async () => {
    const db = makeDb([
      [{ ticket_type_id: TICKET_TYPE_ID }],
      [{ date: new Date(Date.now() + 86400000 * 10).toISOString() }],  // 10 days away
      [makeTransferDeadlineRow({ allow_transfers: false })],
    ]);

    const result = await isTransferAllowed(TICKET_ID, EVENT_ID, db);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('TRANSFERS_DISABLED');
  });

  it('vrátí TICKET_NOT_FOUND pokud vstupenka neexistuje', async () => {
    const db = makeDb([[]], vi.fn());

    const result = await isTransferAllowed(TICKET_ID, EVENT_ID, db);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('TICKET_NOT_FOUND');
  });
});

describe('enforceTransferDeadline', () => {
  it('vrátí true pokud je transfer povolen', async () => {
    const eventDate = new Date(Date.now() + 86400000 * 10);

    const db = makeDb([
      [{ ticket_type_id: TICKET_TYPE_ID }],
      [{ date: eventDate.toISOString() }],
      [makeTransferDeadlineRow({ days_before_event: 7 })],
    ]);

    const result = await enforceTransferDeadline(TICKET_ID, EVENT_ID, db);

    expect(result).toBe(true);
  });

  it('vrátí false pokud je transfer zakázán', async () => {
    const db = makeDb([
      [{ ticket_type_id: TICKET_TYPE_ID }],
      [],  // no event found
    ]);

    const result = await enforceTransferDeadline(TICKET_ID, EVENT_ID, db);

    expect(result).toBe(false);
  });
});

describe('logTransferAttempt', () => {
  it('zaloguje pokus o transfer', async () => {
    const db = makeDb([[makeTransferLogRow()]]);

    const result = await logTransferAttempt(
      TICKET_ID,
      EVENT_ID,
      USER_ID,
      'user-002',
      'completed',
      undefined,
      db,
    );

    expect(result.ticketId).toBe(TICKET_ID);
    expect(result.transferStatus).toBe('completed');
  });

  it('zaloguje transfer s chybou', async () => {
    const db = makeDb([[makeTransferLogRow({
      transfer_status: 'deadline_exceeded',
      transfer_error: 'DEADLINE_PASSED',
    })]]);

    const result = await logTransferAttempt(
      TICKET_ID,
      EVENT_ID,
      USER_ID,
      'user-002',
      'deadline_exceeded',
      'DEADLINE_PASSED',
      db,
    );

    expect(result.transferError).toBe('DEADLINE_PASSED');
  });
});

describe('markTransferCompleted', () => {
  it('označí transfer jako dokončený', async () => {
    const db = makeDb([[makeTransferLogRow({
      completed_at: new Date().toISOString(),
    })]]);

    const result = await markTransferCompleted('log-001', db);

    expect(result.transferStatus).toBe('completed');
    expect(result.completedAt).toBeDefined();
  });
});

describe('getTransferDeadline', () => {
  it('vrátí transfer deadline pro event', async () => {
    const db = makeDb([[makeTransferDeadlineRow()]]);

    const result = await getTransferDeadline(EVENT_ID, TICKET_TYPE_ID, db);

    expect(result).not.toBeNull();
    expect(result?.daysBeforeEvent).toBe(7);
  });

  it('vrátí null pokud deadline neexistuje', async () => {
    const db = makeDb([[]]);

    const result = await getTransferDeadline(EVENT_ID, TICKET_TYPE_ID, db);

    expect(result).toBeNull();
  });
});

describe('disableTransfers', () => {
  it('zakáže všechny transfery pro event', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeDb([], executeMock);

    await disableTransfers(EVENT_ID, PROMOTER_ID, db);

    expect(executeMock).toHaveBeenCalledTimes(1);
    const sql = executeMock.mock.calls[0][0] as string;
    expect(sql).toContain('allow_transfers = false');
  });
});

describe('enableTransfers', () => {
  it('povolí transfery pro event', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeDb([], executeMock);

    await enableTransfers(EVENT_ID, PROMOTER_ID, db);

    expect(executeMock).toHaveBeenCalledTimes(1);
    const sql = executeMock.mock.calls[0][0] as string;
    expect(sql).toContain('allow_transfers = true');
  });
});
