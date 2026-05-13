import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createQueue,
  joinQueue,
  getQueueStatus,
  advanceQueue,
  validateSession,
  completeSession,
  activateQueue,
  deactivateQueue,
  getQueueConfig,
} from '../services/waiting-room.service.js';
import type { DbAdapter } from '../services/waiting-room.service.js';

const EVENT_ID = 'event-001';
const PROMOTER_ID = 'promoter-001';
const USER_ID = 'user-001';
const SESSION_TOKEN = 'session-abc123';

function makeQueueConfigRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'queue-001',
    event_id: EVENT_ID,
    promoter_id: PROMOTER_ID,
    is_active: true,
    max_concurrent_users: 500,
    entry_rate_per_min: 100,
    session_ttl_seconds: 600,
    randomize_entry: true,
    created_at: '2026-04-14T10:00:00Z',
    updated_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeQueueEntryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-001',
    event_id: EVENT_ID,
    user_id: USER_ID,
    session_token: null,
    queue_position: null,
    status: 'waiting',
    priority_score: '1713094800000',
    joined_at: '2026-04-14T10:00:00Z',
    activated_at: null,
    expires_at: null,
    completed_at: null,
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
      query: vi.fn(async () => {
        const result = queryResults[callIdx] ?? [];
        callIdx++;
        return result;
      }),
      execute: executeMock,
      transaction: vi.fn(),
    } as DbAdapter)),
  };
}

describe('createQueue', () => {
  it('vytvoří nebo aktualizuje waiting room konfiguraci', async () => {
    const db = makeDb([[makeQueueConfigRow()]]);

    const result = await createQueue(
      EVENT_ID,
      PROMOTER_ID,
      { maxConcurrentUsers: 500, entryRatePerMin: 100 },
      db,
    );

    expect(result.eventId).toBe(EVENT_ID);
    expect(result.maxConcurrentUsers).toBe(500);
  });
});

describe('joinQueue', () => {
  it('přidá uživatele do fronty', async () => {
    const db = makeDb([[makeQueueEntryRow()]]);

    const result = await joinQueue(EVENT_ID, USER_ID, db);

    expect(result.status).toBe('waiting');
    expect(result.userId).toBe(USER_ID);
  });

  it('vyhodí VALIDATION_ERROR bez userId', async () => {
    const db = makeDb([]);

    await expect(joinQueue(EVENT_ID, '', db)).rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('getQueueStatus', () => {
  it('vrátí pozici ve frontě a odhadovaný čas čekání', async () => {
    const db = makeDb([
      [makeQueueConfigRow()],
      [makeQueueEntryRow()],
      [{ waiting_count: '150', active_count: '200' }],
    ]);

    const result = await getQueueStatus(EVENT_ID, USER_ID, db);

    expect(result.position).toBe(151);  // 150 ahead + 1
    expect(result.waitingCount).toBe(150);
    expect(result.estimatedWaitMinutes).toBe(2);  // ceil(150 / 100)
    expect(result.isActive).toBe(false);
  });

  it('vrátí prázdný status pokud uživatel není ve frontě', async () => {
    const db = makeDb([
      [makeQueueConfigRow()],
      [],  // no entry
    ]);

    const result = await getQueueStatus(EVENT_ID, 'unknown-user', db);

    expect(result.position).toBe(0);
    expect(result.isActive).toBe(false);
  });

  it('vrátí sessionToken pokud je uživatel aktivní', async () => {
    const db = makeDb([
      [makeQueueConfigRow()],
      [makeQueueEntryRow({ status: 'active', session_token: SESSION_TOKEN, expires_at: '2026-04-14T11:00:00Z' })],
      [{ waiting_count: '0', active_count: '100' }],
    ]);

    const result = await getQueueStatus(EVENT_ID, USER_ID, db);

    expect(result.isActive).toBe(true);
    expect(result.sessionToken).toBe(SESSION_TOKEN);
  });
});

describe('advanceQueue', () => {
  it('aktivuje další dávku uživatelů z fronty', async () => {
    const activatedEntry = { id: 'entry-002' };
    const db = makeDb([
      [makeQueueConfigRow()],  // config check
      [{ count: '300' }],       // active count (200 slots available)
      undefined as any,         // expire old sessions
      [activatedEntry, { id: 'entry-003' }],  // activated entries
    ]);

    const count = await advanceQueue(EVENT_ID, db);

    expect(count).toBe(2);
  });

  it('vrátí 0 pokud fronta není aktivní', async () => {
    const db = makeDb([[]], vi.fn());

    const count = await advanceQueue(EVENT_ID, db);

    expect(count).toBe(0);
  });
});

describe('validateSession', () => {
  it('ověří platný session token', async () => {
    const db = makeDb([[makeQueueEntryRow({ status: 'active', session_token: SESSION_TOKEN })]]);

    const result = await validateSession(EVENT_ID, SESSION_TOKEN, db);

    expect(result).not.toBeNull();
    expect(result?.sessionToken).toBe(SESSION_TOKEN);
  });

  it('vrátí null pro neplatný nebo expirovaný token', async () => {
    const db = makeDb([[]]);

    const result = await validateSession(EVENT_ID, 'invalid-token', db);

    expect(result).toBeNull();
  });
});

describe('completeSession', () => {
  it('označí session jako dokončenou po nákupu', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeDb([], executeMock);

    await completeSession(EVENT_ID, SESSION_TOKEN, db);

    expect(executeMock).toHaveBeenCalledTimes(1);
    const sql = executeMock.mock.calls[0][0] as string;
    expect(sql).toContain('completed');
  });
});

describe('activateQueue / deactivateQueue', () => {
  it('aktivuje a deaktivuje waiting room frontu', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeDb([], executeMock);

    await activateQueue(EVENT_ID, db);
    await deactivateQueue(EVENT_ID, db);

    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(executeMock.mock.calls[0][0]).toContain('is_active = true');
    expect(executeMock.mock.calls[1][0]).toContain('is_active = false');
  });
});

describe('getQueueConfig', () => {
  it('vrátí konfiguraci fronty', async () => {
    const db = makeDb([[makeQueueConfigRow()]]);

    const result = await getQueueConfig(EVENT_ID, db);

    expect(result).not.toBeNull();
    expect(result?.isActive).toBe(true);
  });

  it('vrátí null pokud fronta neexistuje', async () => {
    const db = makeDb([[]]);

    const result = await getQueueConfig(EVENT_ID, db);

    expect(result).toBeNull();
  });
});
