import { describe, it, expect, vi } from 'vitest';
import {
  addToBlocklist,
  removeFromBlocklist,
  listBlocklist,
  isBlocked,
} from '../services/blocklist.service.js';

function makeDb(queryResults: unknown[][] = []) {
  let idx = 0;
  return {
    query: vi.fn().mockImplementation(() => Promise.resolve(queryResults[idx++] ?? [])),
    execute: vi.fn().mockResolvedValue(undefined),
  };
}

const fpHash = 'a'.repeat(64);
const userId = 'b1b2b3b4-0000-0000-0000-000000000001';

describe('addToBlocklist', () => {
  it('inserts new entry and returns it', async () => {
    const entry = {
      id: 'c1c2c3c4-0000-0000-0000-000000000001',
      fingerprintHash: fpHash,
      reason: 'automated bot',
      blockedBy: userId,
      blockedAt: '2026-04-11T10:00:00Z',
      expiresAt: null,
    };
    const db = makeDb([[entry]]);
    const result = await addToBlocklist(fpHash, 'automated bot', userId, null, { db });
    expect(result).toEqual(entry);
    expect(db.query).toHaveBeenCalledOnce();
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('INSERT INTO risk.fingerprint_blocklist');
    expect(sql).toContain('ON CONFLICT');
  });

  it('passes expiresAt when provided', async () => {
    const expires = new Date('2026-05-01T00:00:00Z');
    const db = makeDb([[{ id: '1', fingerprintHash: fpHash, reason: 'test', blockedBy: userId, blockedAt: '', expiresAt: expires.toISOString() }]]);
    await addToBlocklist(fpHash, 'test', userId, expires, { db });
    const params = db.query.mock.calls[0][1] as unknown[];
    expect(params[3]).toBe('2026-05-01T00:00:00.000Z');
  });
});

describe('removeFromBlocklist', () => {
  it('returns true when entry was deleted', async () => {
    const db = makeDb([[{ id: '1' }]]);
    const result = await removeFromBlocklist(fpHash, { db });
    expect(result).toBe(true);
  });

  it('returns false when no entry found', async () => {
    const db = makeDb([[]]);
    const result = await removeFromBlocklist(fpHash, { db });
    expect(result).toBe(false);
  });
});

describe('listBlocklist', () => {
  it('returns entries and total count', async () => {
    const entries = [
      { id: '1', fingerprintHash: fpHash, reason: 'bot', blockedBy: userId, blockedAt: '2026-04-11T00:00:00Z', expiresAt: null },
    ];
    const db = makeDb([entries, [{ count: '1' }]]);
    const result = await listBlocklist(50, 0, { db });
    expect(result.entries).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('passes limit and offset to query', async () => {
    const db = makeDb([[], [{ count: '0' }]]);
    await listBlocklist(20, 10, { db });
    const params = db.query.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe(20);
    expect(params[1]).toBe(10);
  });
});

describe('isBlocked', () => {
  it('returns true when fingerprint is actively blocked', async () => {
    const db = makeDb([[{ count: '1' }]]);
    expect(await isBlocked(fpHash, { db })).toBe(true);
  });

  it('returns false when not blocked', async () => {
    const db = makeDb([[{ count: '0' }]]);
    expect(await isBlocked(fpHash, { db })).toBe(false);
  });

  it('query filters by non-expired entries', async () => {
    const db = makeDb([[{ count: '0' }]]);
    await isBlocked(fpHash, { db });
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('expires_at IS NULL OR expires_at > NOW()');
  });
});
