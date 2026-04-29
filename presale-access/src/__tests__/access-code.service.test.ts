import { describe, it, expect, vi } from 'vitest';
import {
  createAccessCode,
  redeemAccessCode,
  listAccessCodes,
  setTicketTypeVisibility,
} from '../services/access-code.service.js';
import type { DbAdapter } from '../services/access-code.service.js';

function makeCodeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'code-001',
    event_id: 'event-001',
    promoter_id: 'promoter-001',
    code: 'FANCLUB2026',
    label: 'Fan Club Presale',
    max_uses: 100,
    uses_count: 0,
    valid_from: null,
    valid_until: null,
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
  };
}

describe('createAccessCode', () => {
  it('vytvoří přístupový kód a napojí ticket typy', async () => {
    const db = makeDb([[makeCodeRow()]]);
    const result = await createAccessCode({
      eventId: 'event-001',
      promoterId: 'promoter-001',
      ticketTypeIds: ['tt-001', 'tt-002'],
      label: 'Fan Club Presale',
      maxUses: 100,
    }, db);

    expect(result.code).toBe('FANCLUB2026');
    expect(result.ticketTypeIds).toEqual(['tt-001', 'tt-002']);
    expect(db.execute).toHaveBeenCalledTimes(2); // one per ticket type
  });

  it('vygeneruje kód automaticky pokud není zadán', async () => {
    const db = makeDb([[makeCodeRow({ code: 'A1B2C3' })]]);
    const result = await createAccessCode({
      eventId: 'event-001',
      promoterId: 'promoter-001',
      ticketTypeIds: ['tt-001'],
    }, db);
    expect(result.code).toBeTruthy();
  });

  it('odmítne prázdný seznam ticket typů', async () => {
    const db = makeDb();
    await expect(createAccessCode({
      eventId: 'e', promoterId: 'p', ticketTypeIds: [],
    }, db)).rejects.toThrow('at least one ticketTypeId');
  });

  it('převede vlastní kód na UPPERCASE', async () => {
    const db = makeDb([[makeCodeRow({ code: 'VIPCODE' })]]);
    await createAccessCode({
      eventId: 'e', promoterId: 'p', ticketTypeIds: ['tt-001'],
      customCode: 'vipcode',
    }, db);
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sql[1]).toContain('VIPCODE');
  });
});

describe('redeemAccessCode', () => {
  it('uplatní platný kód a vrátí ticket type IDs', async () => {
    const db = makeDb([
      [makeCodeRow({ uses_count: 1 })],    // updated row after atomic increment
      [{ ticket_type_id: 'tt-001' }, { ticket_type_id: 'tt-002' }],
    ]);

    const result = await redeemAccessCode('event-001', 'FANCLUB2026', db);
    expect(result.ticketTypeIds).toEqual(['tt-001', 'tt-002']);
    expect(result.accessCodeId).toBe('code-001');
  });

  it('odmítne neplatný nebo vyčerpaný kód', async () => {
    const db = makeDb([[]]); // empty = no match (expired or exhausted)
    await expect(redeemAccessCode('event-001', 'WRONGCODE', db))
      .rejects.toThrow('ACCESS_CODE_INVALID_OR_EXHAUSTED');
  });

  it('kód je case-insensitive (UPPER() v SQL)', async () => {
    const db = makeDb([[makeCodeRow({ uses_count: 1 })], [{ ticket_type_id: 'tt-001' }]]);
    const result = await redeemAccessCode('event-001', 'fanclub2026', db);
    // SQL uses UPPER($2) so lowercase input works
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('UPPER($2)');
    expect(result.ticketTypeIds).toHaveLength(1);
  });
});

describe('listAccessCodes', () => {
  it('vrátí seznam přístupových kódů pro event', async () => {
    const db = makeDb([
      [makeCodeRow(), makeCodeRow({ id: 'code-002', code: 'PRESS2026' })],
      [{ ticket_type_id: 'tt-001' }],  // ticket types for code-001
      [{ ticket_type_id: 'tt-002' }],  // ticket types for code-002
    ]);

    const result = await listAccessCodes('event-001', 'promoter-001', db);
    expect(result).toHaveLength(2);
    expect(result[0].ticketTypeIds).toEqual(['tt-001']);
    expect(result[1].ticketTypeIds).toEqual(['tt-002']);
  });
});

describe('setTicketTypeVisibility', () => {
  it('nastaví viditelnost ticket typu na access_code', async () => {
    const db = makeDb([[{ id: 'tt-001' }]]);
    await expect(setTicketTypeVisibility('tt-001', 'promoter-001', 'access_code', db))
      .resolves.toBeUndefined();
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('visibility = $2');
  });

  it('vyhodí chybu pro nenalezený ticket type', async () => {
    const db = makeDb([[]]); // not found
    await expect(setTicketTypeVisibility('tt-bad', 'promoter-001', 'hidden', db))
      .rejects.toThrow('TICKET_TYPE_NOT_FOUND');
  });

  it('nastaví na public (reset)', async () => {
    const db = makeDb([[{ id: 'tt-001' }]]);
    await setTicketTypeVisibility('tt-001', 'promoter-001', 'public', db);
    const params = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][1] as unknown[];
    expect(params).toContain('public');
  });
});
