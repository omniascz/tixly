import { describe, it, expect, vi } from 'vitest';
import {
  createBogoRule,
  calculateBogoDiscount,
  applyBogoRules,
  listBogoRules,
  deactivateBogoRule,
} from '../services/bogo.service.js';
import type { DbAdapter, BogoRule } from '../services/bogo.service.js';

function makeRuleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rule-001',
    promoter_id: 'promoter-001',
    event_id: 'event-001',
    name: 'Kup 2 dostaneš 1 zdarma',
    description: null,
    trigger_qty: 2,
    free_qty: 1,
    max_free_tickets: null,
    applies_to_ticket_type_ids: [],
    discount_pct: null,  // null = 100% off
    is_active: true,
    valid_from: null,
    valid_until: null,
    created_at: '2026-04-14T08:00:00Z',
    ...overrides,
  };
}

function makeRule(overrides: Partial<BogoRule> = {}): BogoRule {
  return {
    id: 'rule-001',
    promoterId: 'promoter-001',
    eventId: 'event-001',
    name: 'Kup 2 dostaneš 1 zdarma',
    description: null,
    triggerQty: 2,
    freeQty: 1,
    maxFreeTickets: null,
    appliesToTicketTypeIds: [],
    discountPct: null,
    isActive: true,
    validFrom: null,
    validUntil: null,
    createdAt: '2026-04-14T08:00:00Z',
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

const CART = [
  { ticketTypeId: 'tt-001', qty: 2, unitPriceHellers: 50000 },
];

describe('createBogoRule', () => {
  it('vytvoří BOGO pravidlo Kup 2 dostaneš 1 zdarma', async () => {
    const db = makeDb([[makeRuleRow()]]);
    const result = await createBogoRule({
      promoterId: 'promoter-001',
      eventId: 'event-001',
      name: 'Kup 2 dostaneš 1 zdarma',
      triggerQty: 2,
      freeQty: 1,
    }, db);

    expect(result.triggerQty).toBe(2);
    expect(result.freeQty).toBe(1);
    expect(result.discountPct).toBeNull();
  });

  it('odmítne prázdné jméno', async () => {
    const db = makeDb();
    await expect(createBogoRule({
      promoterId: 'p', eventId: 'e', name: '   ', triggerQty: 2, freeQty: 1,
    }, db)).rejects.toThrow('name is required');
  });

  it('odmítne triggerQty < 1', async () => {
    const db = makeDb();
    await expect(createBogoRule({
      promoterId: 'p', eventId: 'e', name: 'Rule', triggerQty: 0, freeQty: 1,
    }, db)).rejects.toThrow('triggerQty must be >= 1');
  });

  it('odmítne discountPct mimo rozsah', async () => {
    const db = makeDb();
    await expect(createBogoRule({
      promoterId: 'p', eventId: 'e', name: 'Rule', triggerQty: 2, freeQty: 1, discountPct: 110,
    }, db)).rejects.toThrow('discountPct must be between 0 and 100');
  });
});

describe('calculateBogoDiscount', () => {
  it('Kup 2 dostaneš 1 zdarma: 2 vstupenky → 1 zdarma', () => {
    const rule = makeRule({ triggerQty: 2, freeQty: 1 });
    const result = calculateBogoDiscount(rule, CART);
    expect(result).not.toBeNull();
    expect(result!.freeQtyGranted).toBe(1);
    expect(result!.discountHellers).toBe(50000);
  });

  it('Kup 4 dostaneš 2 zdarma: 6 vstupenek → 2 skupiny → 4 zdarma', () => {
    const rule = makeRule({ triggerQty: 2, freeQty: 2 });
    const cart = [{ ticketTypeId: 'tt-001', qty: 6, unitPriceHellers: 30000 }];
    const result = calculateBogoDiscount(rule, cart);
    expect(result!.freeQtyGranted).toBe(6); // 3 groups * 2 free each
  });

  it('vrátí null pokud nesplňuje trigger_qty', () => {
    const rule = makeRule({ triggerQty: 3, freeQty: 1 });
    const result = calculateBogoDiscount(rule, [{ ticketTypeId: 'tt-001', qty: 2, unitPriceHellers: 50000 }]);
    expect(result).toBeNull();
  });

  it('respektuje maxFreeTickets', () => {
    const rule = makeRule({ triggerQty: 1, freeQty: 1, maxFreeTickets: 2 });
    const cart = [{ ticketTypeId: 'tt-001', qty: 10, unitPriceHellers: 10000 }];
    const result = calculateBogoDiscount(rule, cart);
    expect(result!.freeQtyGranted).toBe(2);
    expect(result!.discountHellers).toBe(20000);
  });

  it('aplikuje se jen na specifikované ticket typy', () => {
    const rule = makeRule({ triggerQty: 2, freeQty: 1, appliesToTicketTypeIds: ['tt-VIP'] });
    const cart = [
      { ticketTypeId: 'tt-001', qty: 4, unitPriceHellers: 50000 },  // not eligible
      { ticketTypeId: 'tt-VIP', qty: 2, unitPriceHellers: 100000 },  // eligible
    ];
    const result = calculateBogoDiscount(rule, cart);
    expect(result).not.toBeNull();
    expect(result!.freeQtyGranted).toBe(1);
    expect(result!.discountHellers).toBe(100000);
  });

  it('částečná sleva (discountPct=50): Kup 4 dostaneš 50% slevu na 2', () => {
    const rule = makeRule({ triggerQty: 2, freeQty: 1, discountPct: 50 });
    const cart = [{ ticketTypeId: 'tt-001', qty: 4, unitPriceHellers: 20000 }];
    const result = calculateBogoDiscount(rule, cart);
    // 4/2=2 groups, 2 free tickets at 50% off = 2 * 10000 = 20000
    expect(result!.discountHellers).toBe(20000);
  });
});

describe('applyBogoRules', () => {
  it('aplikuje nejlepší pravidlo a zaloguje použití', async () => {
    const db = makeDb([[makeRuleRow()]]);
    const result = await applyBogoRules('event-001', 'order-001', CART, db);

    expect(result).not.toBeNull();
    expect(result!.freeQtyGranted).toBe(1);
    expect(db.execute).toHaveBeenCalledOnce(); // log usage
  });

  it('vrátí null pokud žádné pravidlo nesedí', async () => {
    const db = makeDb([[makeRuleRow({ trigger_qty: 10 })]]);
    const result = await applyBogoRules('event-001', 'order-001', CART, db);
    expect(result).toBeNull();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('vybere pravidlo s největší slevou', async () => {
    const db = makeDb([[
      makeRuleRow({ trigger_qty: 2, free_qty: 1 }),                  // 1 free = 50000 discount
      makeRuleRow({ id: 'rule-002', trigger_qty: 1, free_qty: 1 }),  // 2 free (2 groups) = 100000 discount
    ]]);
    const result = await applyBogoRules('event-001', 'order-001', CART, db);
    // rule-002 gives 100000 (2 free tickets) which is the better deal
    expect(result!.discountHellers).toBe(100000);
  });
});

describe('listBogoRules', () => {
  it('vrátí seznam pravidel pro event', async () => {
    const db = makeDb([[makeRuleRow(), makeRuleRow({ id: 'rule-002', name: 'Kup 3 za cenu 2' })]]);
    const result = await listBogoRules('event-001', 'promoter-001', db);
    expect(result).toHaveLength(2);
  });
});

describe('deactivateBogoRule', () => {
  it('deaktivuje pravidlo', async () => {
    const db = makeDb([[{ id: 'rule-001' }]]);
    await expect(deactivateBogoRule('rule-001', 'promoter-001', db)).resolves.toBeUndefined();
  });

  it('vyhodí chybu pro nenalezené pravidlo', async () => {
    const db = makeDb([[]]); // empty
    await expect(deactivateBogoRule('bad-id', 'promoter-001', db)).rejects.toThrow('RULE_NOT_FOUND');
  });
});
