import { describe, it, expect, vi } from 'vitest';
import {
  shareLocation,
  getNearbyFriends,
  stopSharingLocation,
  cleanupExpiredLocations,
} from '../services/friend-location.service.js';
import type { DbAdapter } from '../services/friend-location.service.js';

const EVENT_ID = 'event-001';
const USER_ID = 'user-001';
const FRIEND_ID = 'user-002';

function makeLocationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'loc-001',
    event_id: EVENT_ID,
    user_id: FRIEND_ID,
    user_display_name: 'Alex',
    latitude: 50.0806,
    longitude: 14.4283,
    accuracy: 10,
    last_seen_at: '2026-04-14T10:55:00Z',
    created_at: '2026-04-14T10:00:00Z',
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

describe('shareLocation', () => {
  it('uloží polohu s upsert (ON CONFLICT)', async () => {
    const db = makeDb([[makeLocationRow({ user_id: USER_ID })]]);

    const result = await shareLocation(EVENT_ID, USER_ID, {
      latitude: 50.0806,
      longitude: 14.4283,
      accuracy: 10,
      displayName: 'Me',
    }, db);

    expect(result.latitude).toBe(50.0806);
    expect(result.longitude).toBe(14.4283);
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('last_seen_at = NOW()');
  });

  it('vyhodí VALIDATION_ERROR pro nevalidní souřadnice', async () => {
    const db = makeDb([]);

    await expect(
      shareLocation(EVENT_ID, USER_ID, {
        latitude: 91,  // > 90
        longitude: 0,
        displayName: 'Me',
      }, db),
    ).rejects.toThrow('VALIDATION_ERROR');

    await expect(
      shareLocation(EVENT_ID, USER_ID, {
        latitude: 0,
        longitude: 181,  // > 180
        displayName: 'Me',
      }, db),
    ).rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('getNearbyFriends', () => {
  it('vrátí blízké přátele z posledních 5 minut', async () => {
    const db = makeDb([[
      makeLocationRow({ user_id: FRIEND_ID, last_seen_at: '2026-04-14T10:55:00Z' }),
      makeLocationRow({ id: 'loc-2', user_id: 'user-003', last_seen_at: '2026-04-14T10:56:00Z' }),
    ]]);

    const result = await getNearbyFriends(EVENT_ID, USER_ID, 100, db);

    expect(result).toHaveLength(2);
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('last_seen_at > NOW() - INTERVAL');
    expect(sql).toContain('5 minutes');
    expect(sql).toContain('ST_DWithin');  // proximity check
  });

  it('exkluduje uživatele sám sebe (user_id != $2)', async () => {
    const db = makeDb([[]]);

    await getNearbyFriends(EVENT_ID, USER_ID, 100, db);

    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('user_id != $2');
  });
});

describe('stopSharingLocation', () => {
  it('smaže polohu pro uživatele na eventu', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeDb([], executeMock);

    await stopSharingLocation(EVENT_ID, USER_ID, db);

    expect(executeMock).toHaveBeenCalledTimes(1);
    const sql = executeMock.mock.calls[0][0] as string;
    expect(sql).toContain('DELETE');
    expect(sql).toContain('event_id = $1');
    expect(sql).toContain('user_id = $2');
  });
});

describe('cleanupExpiredLocations', () => {
  it('smaže polohy starší než 1 den', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeDb([], executeMock);

    await cleanupExpiredLocations(db);

    expect(executeMock).toHaveBeenCalledTimes(1);
    const sql = executeMock.mock.calls[0][0] as string;
    expect(sql).toContain('DELETE');
    expect(sql).toContain('1 day');
  });
});
