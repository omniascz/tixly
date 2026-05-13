import { describe, it, expect, vi } from 'vitest';
import {
  validateTicketDryRun,
  getValidationErrors,
  enablePreEntryMode,
  disablePreEntryMode,
  isEventInPreEntryMode,
  batchValidateTickets,
  getPreEntryChecks,
} from '../services/validator.service.js';
import type { DbAdapter } from '../services/validator.service.js';

const EVENT_ID = 'event-001';
const PROMOTER_ID = 'promoter-001';
const TICKET_ID = 'ticket-001';
const STAFF_EMAIL = 'staff@example.com';

function makePreEntryCheckRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'check-001',
    event_id: EVENT_ID,
    ticket_id: TICKET_ID,
    is_valid: true,
    validation_error: null,
    staff_email: STAFF_EMAIL,
    checked_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeEventEntryModeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mode-001',
    event_id: EVENT_ID,
    promoter_id: PROMOTER_ID,
    pre_entry_mode: true,
    pre_entry_start: '2026-05-15T08:00:00Z',
    pre_entry_end: '2026-05-15T10:00:00Z',
    allow_batch_check: true,
    created_at: '2026-04-14T10:00:00Z',
    updated_at: '2026-04-14T10:00:00Z',
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

describe('validateTicketDryRun', () => {
  it('validuje vstupenku bez zápisu do scan logu', async () => {
    const db = makeDb([
      [{ id: TICKET_ID, status: 'valid' }],  // ticket check
      [makePreEntryCheckRow()],  // pre-entry check result
    ]);

    const result = await validateTicketDryRun(EVENT_ID, TICKET_ID, STAFF_EMAIL, db);

    expect(result.isValid).toBe(true);
    expect(result.validationError).toBeUndefined();
  });

  it('vrátí TICKET_REFUNDED pro vracenou vstupenku', async () => {
    const db = makeDb([
      [{ id: TICKET_ID, status: 'refunded' }],
      [makePreEntryCheckRow({ is_valid: false, validation_error: 'TICKET_REFUNDED' })],
    ]);

    const result = await validateTicketDryRun(EVENT_ID, TICKET_ID, STAFF_EMAIL, db);

    expect(result.isValid).toBe(false);
    expect(result.validationError).toBe('TICKET_REFUNDED');
  });

  it('vrátí TICKET_NOT_FOUND pokud vstupenka neexistuje', async () => {
    const db = makeDb([
      [],  // no ticket found
      [makePreEntryCheckRow({ is_valid: false, validation_error: 'TICKET_NOT_FOUND' })],
    ]);

    const result = await validateTicketDryRun(EVENT_ID, 'nonexistent', STAFF_EMAIL, db);

    expect(result.isValid).toBe(false);
    expect(result.validationError).toBe('TICKET_NOT_FOUND');
  });
});

describe('getValidationErrors', () => {
  it('vrátí null pro platnou vstupenku', async () => {
    const db = makeDb([[{ id: TICKET_ID, status: 'valid' }]]);

    const result = await getValidationErrors(EVENT_ID, TICKET_ID, db);

    expect(result).toBeNull();
  });

  it('vrátí chybu pro vrácenou vstupenku', async () => {
    const db = makeDb([[{ id: TICKET_ID, status: 'refunded' }]]);

    const result = await getValidationErrors(EVENT_ID, TICKET_ID, db);

    expect(result).not.toBeNull();
    expect(result?.code).toBe('REFUNDED');
    expect(result?.message).toContain('refunded');
  });

  it('vrátí TICKET_NOT_FOUND pokud vstupenka chybí', async () => {
    const db = makeDb([[]]);

    const result = await getValidationErrors(EVENT_ID, 'nonexistent', db);

    expect(result?.code).toBe('TICKET_NOT_FOUND');
  });
});

describe('enablePreEntryMode', () => {
  it('povolí pre-entry režim pro event', async () => {
    const db = makeDb([[makeEventEntryModeRow()]]);
    const start = new Date('2026-05-15T08:00:00Z');
    const end = new Date('2026-05-15T10:00:00Z');

    const result = await enablePreEntryMode(EVENT_ID, PROMOTER_ID, start, end, db);

    expect(result.preEntryMode).toBe(true);
    expect(result.eventId).toBe(EVENT_ID);
  });
});

describe('disablePreEntryMode', () => {
  it('vypne pre-entry režim', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeDb([], executeMock);

    await disablePreEntryMode(EVENT_ID, db);

    expect(executeMock).toHaveBeenCalledTimes(1);
    const sql = executeMock.mock.calls[0][0] as string;
    expect(sql).toContain('pre_entry_mode = false');
  });
});

describe('isEventInPreEntryMode', () => {
  it('vrátí true pokud je event v pre-entry režimu', async () => {
    const db = makeDb([[{ pre_entry_mode: true }]]);

    const result = await isEventInPreEntryMode(EVENT_ID, db);

    expect(result).toBe(true);
  });

  it('vrátí false pokud event není v pre-entry režimu', async () => {
    const db = makeDb([[]]);

    const result = await isEventInPreEntryMode(EVENT_ID, db);

    expect(result).toBe(false);
  });
});

describe('batchValidateTickets', () => {
  it('validuje více vstupenek najednou', async () => {
    const db = makeDb([
      [{ id: 'ticket-1', status: 'valid' }],  // first ticket check
      [makePreEntryCheckRow({ ticket_id: 'ticket-1', is_valid: true })],  // first result
      [{ id: 'ticket-2', status: 'valid' }],  // second ticket check
      [makePreEntryCheckRow({ ticket_id: 'ticket-2', is_valid: true })],  // second result
      [{ id: 'batch-001' }],  // batch result
    ]);

    const result = await batchValidateTickets(
      EVENT_ID,
      ['ticket-1', 'ticket-2'],
      STAFF_EMAIL,
      db,
    );

    expect(result.totalChecked).toBe(2);
    expect(result.validCount).toBe(2);
    expect(result.invalidCount).toBe(0);
  });

  it('vyhodí VALIDATION_ERROR bez vstupenek', async () => {
    const db = makeDb([]);

    await expect(
      batchValidateTickets(EVENT_ID, [], STAFF_EMAIL, db),
    ).rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('getPreEntryChecks', () => {
  it('vrátí pre-entry kontroly pro event', async () => {
    const db = makeDb([[
      makePreEntryCheckRow({ id: 'check-001' }),
      makePreEntryCheckRow({ id: 'check-002', ticket_id: 'ticket-002' }),
    ]]);

    const result = await getPreEntryChecks(EVENT_ID, 100, 0, db);

    expect(result).toHaveLength(2);
    expect(result[0].eventId).toBe(EVENT_ID);
  });
});
