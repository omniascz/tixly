import { describe, it, expect, vi } from 'vitest';
import {
  updateEnhancedContent,
  getEnhancedContent,
  pushToWallet,
} from '../services/enhanced-pass.service.js';
import type { DbAdapter } from '../services/enhanced-pass.service.js';

const PASS_ID = 'pass-001';
const EVENT_ID = 'event-001';

function makeContentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'content-001',
    pass_id: PASS_ID,
    event_id: EVENT_ID,
    weather: { temperatureC: 18, condition: 'sunny', icon: '☀️' },
    venue_map: { lat: 50.0806, lng: 14.4283, label: 'Praha venue' },
    setlist: [
      { artistName: 'Alice', startTime: '2026-04-20T19:00:00Z', duration: 45 },
      { artistName: 'Bob', startTime: '2026-04-20T20:00:00Z', duration: 60 },
    ],
    playlist: { spotifyPlaylistId: 'spotify-123', title: 'Event Mix', trackCount: 50 },
    last_updated_at: '2026-04-14T10:00:00Z',
    last_pushed_at: null,
    ...overrides,
  };
}

function makeDb(queryResults: unknown[][] = []): DbAdapter {
  let callIdx = 0;
  return {
    query: vi.fn(async () => {
      const result = queryResults[callIdx] ?? [];
      callIdx++;
      return result;
    }),
    execute: vi.fn(),
    transaction: vi.fn(async (fn) => fn({
      query: vi.fn().mockResolvedValue([]),
      execute: vi.fn(),
      transaction: vi.fn(),
    } as DbAdapter)),
  };
}

describe('updateEnhancedContent', () => {
  it('vytvoří nebo aktualizuje enhanced content s ON CONFLICT upsert', async () => {
    const db = makeDb([[makeContentRow()]]);

    const result = await updateEnhancedContent(PASS_ID, EVENT_ID, {
      weather: { temperatureC: 18, condition: 'sunny', icon: '☀️' },
      setlist: [
        { artistName: 'Alice', startTime: '2026-04-20T19:00:00Z', duration: 45 },
      ],
    }, db);

    expect(result.passId).toBe(PASS_ID);
    expect(result.weather?.temperatureC).toBe(18);
    expect(result.setlist).toHaveLength(2);
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('DO UPDATE');
  });

  it('přijme null hodnoty pro weather a playlist', async () => {
    const db = makeDb([[makeContentRow({ weather: null, playlist: null })]]);

    const result = await updateEnhancedContent(PASS_ID, EVENT_ID, {
      weather: null,
      playlist: null,
    }, db);

    expect(result.weather).toBeNull();
    expect(result.playlist).toBeNull();
  });

  it('setlist se normalizuje na prázdné pole pokud neuvedeno', async () => {
    const db = makeDb([[makeContentRow({ setlist: [] })]]);

    const result = await updateEnhancedContent(PASS_ID, EVENT_ID, {}, db);

    expect(result.setlist).toEqual([]);
  });
});

describe('getEnhancedContent', () => {
  it('vrátí enhanced content dle pass_id', async () => {
    const db = makeDb([[makeContentRow()]]);

    const result = await getEnhancedContent(PASS_ID, db);

    expect(result).not.toBeNull();
    expect(result?.passId).toBe(PASS_ID);
    expect(result?.weather?.temperatureC).toBe(18);
  });

  it('vrátí null pokud content neexistuje', async () => {
    const db = makeDb([[]]);

    const result = await getEnhancedContent(PASS_ID, db);

    expect(result).toBeNull();
  });
});

describe('pushToWallet', () => {
  it('nastaví last_pushed_at a vrátí updated row', async () => {
    const db = makeDb([[makeContentRow({ last_pushed_at: '2026-04-14T11:00:00Z' })]]);

    const result = await pushToWallet(PASS_ID, db);

    expect(result.lastPushedAt).toBe('2026-04-14T11:00:00Z');
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('last_pushed_at = NOW()');
  });

  it('vyhodí NOT_FOUND pokud content neexistuje', async () => {
    const db = makeDb([[]]);

    await expect(pushToWallet(PASS_ID, db)).rejects.toThrow('NOT_FOUND');
  });
});
