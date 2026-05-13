import { describe, it, expect, vi } from 'vitest';
import {
  setResaleRules,
  getResaleRules,
  checkResaleAllowed,
  setTicketTypeOverride,
  PLATFORM_DEFAULT_CAP_PCT,
} from '../services/resale-rules.service.js';
import type { DbAdapter } from '../services/resale-rules.service.js';

function makeRulesRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rule-001',
    event_id: 'event-001',
    promoter_id: 'promoter-001',
    resale_allowed: true,
    price_cap_pct: '100.00',
    max_transfers_per_ticket: 2,
    require_id_match: false,
    block_reason: null,
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
  };
}

describe('setResaleRules', () => {
  it('nastaví pravidla pro resale', async () => {
    const db = makeDb([[makeRulesRow()]]);

    const result = await setResaleRules('event-001', 'promoter-001', {
      resaleAllowed: true,
      priceCappct: 100.0,
      maxTransfersPerTicket: 2,
    }, db);

    expect(result.resaleAllowed).toBe(true);
    expect(result.priceCappct).toBe(100.0);
    expect(result.maxTransfersPerTicket).toBe(2);
  });

  it('zakáže resale s důvodem', async () => {
    const db = makeDb([[makeRulesRow({ resale_allowed: false, price_cap_pct: null, block_reason: 'Artist request' })]]);

    const result = await setResaleRules('event-001', 'promoter-001', {
      resaleAllowed: false,
      blockReason: 'Artist request',
    }, db);

    expect(result.resaleAllowed).toBe(false);
    expect(result.blockReason).toBe('Artist request');
  });

  it('vyhodí VALIDATION_ERROR pokud cap překračuje platform maximum', async () => {
    const db = makeDb([]);

    await expect(
      setResaleRules('event-001', 'promoter-001', { priceCappct: 120.0 }, db),
    ).rejects.toThrow('VALIDATION_ERROR');
  });

  it('vyhodí VALIDATION_ERROR pro maxTransfersPerTicket < 1', async () => {
    const db = makeDb([]);

    await expect(
      setResaleRules('event-001', 'promoter-001', { maxTransfersPerTicket: 0 }, db),
    ).rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('getResaleRules', () => {
  it('vrátí pravidla pro akci', async () => {
    const db = makeDb([[makeRulesRow()]]);

    const result = await getResaleRules('event-001', db);

    expect(result).not.toBeNull();
    expect(result?.priceCappct).toBe(100.0);
  });

  it('vrátí null pokud pravidla neexistují', async () => {
    const db = makeDb([[]]); // empty

    const result = await getResaleRules('event-001', db);

    expect(result).toBeNull();
  });
});

describe('checkResaleAllowed', () => {
  it('povolí resale v rámci cenového stropu', async () => {
    // No custom rules — platform defaults apply (110%)
    const db = makeDb([[]]); // getResaleRules returns null

    const result = await checkResaleAllowed('event-001', 'tt-001', 0, 10000, 10000, db);

    expect(result.allowed).toBe(true);
    expect(result.effectiveCapPct).toBe(PLATFORM_DEFAULT_CAP_PCT);
  });

  it('zamítne resale při překročení cenového stropu (platform default)', async () => {
    const db = makeDb([[]]); // no rules

    // 15000 > 110% of 10000 (11000)
    const result = await checkResaleAllowed('event-001', 'tt-001', 0, 15000, 10000, db);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('PRICE_CAP_EXCEEDED');
  });

  it('zamítne resale pokud je resale_allowed = false', async () => {
    const db = makeDb([
      [makeRulesRow({ resale_allowed: false, block_reason: 'Artist request' })],
    ]);

    const result = await checkResaleAllowed('event-001', 'tt-001', 0, 5000, 10000, db);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Artist request');
  });

  it('zamítne resale při překročení max transferů', async () => {
    const db = makeDb([
      [makeRulesRow({ max_transfers_per_ticket: 2 })],
      [],  // no override
    ]);

    // transferCount=2 >= maxTransfers=2
    const result = await checkResaleAllowed('event-001', 'tt-001', 2, 5000, 10000, db);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('MAX_TRANSFERS_EXCEEDED');
  });
});

describe('setTicketTypeOverride', () => {
  it('nastaví override pro konkrétní typ vstupenky', async () => {
    const db = makeDb([
      [makeRulesRow()],  // getResaleRules
      [{                 // INSERT override
        id: 'ov-001',
        resale_rule_id: 'rule-001',
        ticket_type_id: 'tt-vip',
        resale_allowed: false,
        price_cap_pct: null,
        max_transfers_per_ticket: null,
      }],
    ]);

    const result = await setTicketTypeOverride('event-001', 'tt-vip', {
      ticketTypeId: 'tt-vip',
      resaleAllowed: false,
      priceCappct: null,
      maxTransfersPerTicket: null,
    }, db);

    expect(result.ticketTypeId).toBe('tt-vip');
    expect(result.resaleAllowed).toBe(false);
  });

  it('vyhodí RULES_NOT_FOUND pokud event-level pravidla chybí', async () => {
    const db = makeDb([[]]); // no rules found

    await expect(
      setTicketTypeOverride('event-001', 'tt-vip', {
        ticketTypeId: 'tt-vip',
        resaleAllowed: false,
        priceCappct: null,
        maxTransfersPerTicket: null,
      }, db),
    ).rejects.toThrow('RULES_NOT_FOUND');
  });
});
