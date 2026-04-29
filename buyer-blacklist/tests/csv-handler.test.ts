/**
 * Tests for csv-handler and shared-scope visibility.
 */
import { describe, it, expect } from 'vitest';
import {
  parseBlacklistCsv,
  exportBlacklistCsv,
  CsvParseError,
} from '../src/lib/csv-handler.js';
import type { BlacklistEntry } from '../src/types/blacklist.types.js';

describe('parseBlacklistCsv', () => {
  it('parses a valid CSV with all required columns', () => {
    const csv =
      'identifier,type,reason,severity\n' +
      'bad@example.com,email,Chargeback abuse,high\n' +
      '+420777000111,phone,"Ticket scalping, repeat offender",medium\n';

    const rows = parseBlacklistCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      identifier: 'bad@example.com',
      type: 'email',
      reason: 'Chargeback abuse',
      severity: 'high',
    });
    expect(rows[1]!.reason).toBe('Ticket scalping, repeat offender');
    expect(rows[1]!.type).toBe('phone');
  });

  it('throws CsvParseError when a required column is missing', () => {
    const csv = 'identifier,type,reason\nbad@example.com,email,Fraud\n';
    expect(() => parseBlacklistCsv(csv)).toThrowError(CsvParseError);
    expect(() => parseBlacklistCsv(csv)).toThrow(/severity/);
  });

  it('rejects invalid type values', () => {
    const csv = 'identifier,type,reason,severity\nx,invalid,r,low\n';
    expect(() => parseBlacklistCsv(csv)).toThrow(/invalid 'type'/);
  });

  it('handles CRLF line endings and quoted fields with escaped quotes', () => {
    const csv =
      'identifier,type,reason,severity\r\n' +
      'a@b.cz,email,"said ""no-show""",low\r\n';
    const rows = parseBlacklistCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBe('said "no-show"');
  });
});

describe('exportBlacklistCsv', () => {
  it('serializes entries with header and CRLF', () => {
    const entries: BlacklistEntry[] = [
      {
        id: 'e1',
        userId: 'u1',
        email: 'foo@bar.cz',
        promoterId: null,
        scope: 'platform',
        reason: 'fraud, confirmed',
        status: 'active',
        bannedBy: 'admin1',
        bannedAt: new Date('2026-04-08T10:00:00Z'),
        liftedAt: null,
        liftedBy: null,
      },
    ];
    const csv = exportBlacklistCsv(entries);
    expect(csv.split('\r\n')[0]).toBe(
      'identifier,type,reason,severity,scope,status,banned_at',
    );
    expect(csv).toContain('"fraud, confirmed"');
    expect(csv).toContain('platform');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('round-trips through parseBlacklistCsv', () => {
    const entries: BlacklistEntry[] = [
      {
        id: 'e1',
        userId: 'u1',
        email: 'alice@ex.cz',
        promoterId: null,
        scope: 'platform',
        reason: 'spam',
        status: 'active',
        bannedBy: 'admin',
        bannedAt: new Date('2026-04-01T00:00:00Z'),
        liftedAt: null,
        liftedBy: null,
      },
    ];
    const csv = exportBlacklistCsv(entries);
    const parsed = parseBlacklistCsv(csv);
    expect(parsed[0]!.identifier).toBe('alice@ex.cz');
    expect(parsed[0]!.type).toBe('email');
    expect(parsed[0]!.reason).toBe('spam');
  });
});

describe('shared (platform) scope visibility', () => {
  // Integration-level check using a stub db that records queries.
  it('checkBan SQL selects platform-scope entries regardless of promoterId', async () => {
    const { checkBan } = await import('../src/services/blacklist.service.js');

    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const platformRow = {
      id: 'p1',
      user_id: 'u-banned',
      email: 'x@y.cz',
      promoter_id: null,
      scope: 'platform',
      reason: 'fraud',
      status: 'active',
      banned_by: 'admin',
      banned_at: new Date().toISOString(),
      lifted_at: null,
      lifted_by: null,
    };

    const db = {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        if (sql.includes("scope = 'platform'")) return [platformRow];
        return [];
      },
      transaction: async <T,>(fn: (tx: typeof db) => Promise<T>) => fn(db),
    };

    // Promoter A creates shared (platform) ban — promoter B must see it.
    const entryForPromoterB = await checkBan(
      { db: db as never, eventBus: { publish: async () => {} } },
      'u-banned',
      'promoter-B',
    );

    expect(entryForPromoterB).not.toBeNull();
    expect(entryForPromoterB!.scope).toBe('platform');
    // Ensure the platform query ran first (precedence over promoter scope)
    expect(queries[0]!.sql).toContain("scope = 'platform'");
  });
});
