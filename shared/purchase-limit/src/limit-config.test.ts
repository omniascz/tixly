import { describe, it, expect, vi } from 'vitest';
import {
  getEventLimitConfig,
  setEventLimitConfig,
  removeEventLimitConfig,
} from './limit-config.js';
import { DEFAULT_PURCHASE_LIMIT } from './purchase-limit.js';

function makeDb(queryResults: unknown[][] = []) {
  let idx = 0;
  return {
    query: vi.fn().mockImplementation(() => Promise.resolve(queryResults[idx++] ?? [])),
    execute: vi.fn().mockResolvedValue(undefined),
  };
}

describe('getEventLimitConfig', () => {
  it('returns custom config when event has one', async () => {
    const db = makeDb([[{ max_tickets_per_user: 6, verified_only: false }]]);
    const config = await getEventLimitConfig('evt_001', db);
    expect(config.maxTicketsPerUser).toBe(6);
    expect(config.verifiedOnly).toBe(false);
  });

  it('returns platform default when no custom config exists', async () => {
    const db = makeDb([[]]);
    const config = await getEventLimitConfig('evt_002', db);
    expect(config).toEqual(DEFAULT_PURCHASE_LIMIT);
  });
});

describe('setEventLimitConfig', () => {
  it('upserts config and returns result', async () => {
    const entry = {
      eventId: 'evt_001',
      maxTicketsPerUser: 8,
      verifiedOnly: true,
      updatedAt: '2026-04-11T00:00:00Z',
    };
    const db = makeDb([[entry]]);
    const result = await setEventLimitConfig('evt_001', { maxTicketsPerUser: 8, verifiedOnly: true }, db);
    expect(result).toEqual(entry);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('ON CONFLICT');
  });

  it('rejects maxTicketsPerUser < 1', async () => {
    const db = makeDb();
    await expect(
      setEventLimitConfig('evt_001', { maxTicketsPerUser: 0, verifiedOnly: true }, db),
    ).rejects.toThrow('maxTicketsPerUser musí být mezi 1 a 100.');
  });

  it('rejects maxTicketsPerUser > 100', async () => {
    const db = makeDb();
    await expect(
      setEventLimitConfig('evt_001', { maxTicketsPerUser: 101, verifiedOnly: true }, db),
    ).rejects.toThrow('maxTicketsPerUser musí být mezi 1 a 100.');
  });
});

describe('removeEventLimitConfig', () => {
  it('returns true when config was deleted', async () => {
    const db = makeDb([[{ event_id: 'evt_001' }]]);
    expect(await removeEventLimitConfig('evt_001', db)).toBe(true);
  });

  it('returns false when no config existed', async () => {
    const db = makeDb([[]]);
    expect(await removeEventLimitConfig('evt_001', db)).toBe(false);
  });
});
