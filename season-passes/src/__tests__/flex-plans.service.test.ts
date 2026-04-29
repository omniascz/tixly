import { describe, it, expect, vi } from 'vitest';
import {
  createFlexCatalog,
  addEventToCatalog,
  getFlexCatalog,
  listFlexCatalogs,
  getCatalogEvents,
  purchaseFlexPlan,
  getFlexPlan,
  getPlanSelections,
  selectEvents,
} from '../services/flex-plans.service.js';
import type { DbAdapter } from '../services/flex-plans.service.js';

const PROMOTER_ID = 'promoter-001';
const USER_ID = 'user-001';

function makeCatalogRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'catalog-001',
    promoter_id: PROMOTER_ID,
    name: 'Roční fotbalový flex balíček',
    description: 'Vyberte si 10 ze 20 zápasů sezóny',
    select_count: 10,
    price_hellers: 499000,
    currency: 'CZK',
    valid_from: '2026-09-01',
    valid_until: '2027-05-31',
    is_active: true,
    created_at: '2026-04-14T10:00:00Z',
    updated_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeCatalogEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ce-001',
    catalog_id: 'catalog-001',
    event_id: 'event-001',
    ticket_type_id: null,
    display_order: 1,
    ...overrides,
  };
}

function makePlanRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plan-001',
    catalog_id: 'catalog-001',
    user_id: USER_ID,
    promoter_id: PROMOTER_ID,
    status: 'pending_selection',
    payment_id: 'pay-001',
    price_paid_hellers: 499000,
    selections_locked: false,
    created_at: '2026-04-14T10:00:00Z',
    updated_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeSelectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sel-001',
    plan_id: 'plan-001',
    catalog_event_id: 'ce-001',
    event_id: 'event-001',
    ticket_id: null,
    selected_at: '2026-04-14T11:00:00Z',
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

describe('createFlexCatalog', () => {
  it('vytvoří flex katalog', async () => {
    const db = makeDb([[makeCatalogRow()]]);

    const result = await createFlexCatalog(PROMOTER_ID, {
      name: 'Roční fotbalový flex balíček',
      description: 'Vyberte si 10 ze 20 zápasů sezóny',
      selectCount: 10,
      priceHellers: 499000,
    }, db);

    expect(result.name).toBe('Roční fotbalový flex balíček');
    expect(result.selectCount).toBe(10);
    expect(result.priceHellers).toBe(499000);
  });

  it('vyhodí VALIDATION_ERROR pro prázdný název', async () => {
    const db = makeDb([]);

    await expect(createFlexCatalog(PROMOTER_ID, { name: '', selectCount: 10, priceHellers: 100 }, db))
      .rejects.toThrow('VALIDATION_ERROR');
  });

  it('vyhodí VALIDATION_ERROR pro selectCount < 1', async () => {
    const db = makeDb([]);

    await expect(createFlexCatalog(PROMOTER_ID, { name: 'Test', selectCount: 0, priceHellers: 100 }, db))
      .rejects.toThrow('VALIDATION_ERROR');
  });

  it('vyhodí VALIDATION_ERROR pro zápornou cenu', async () => {
    const db = makeDb([]);

    await expect(createFlexCatalog(PROMOTER_ID, { name: 'Test', selectCount: 5, priceHellers: -100 }, db))
      .rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('addEventToCatalog', () => {
  it('přidá akci do katalogu (upsert)', async () => {
    const db = makeDb([[makeCatalogEventRow()]]);

    const result = await addEventToCatalog('catalog-001', 'event-001', null, 1, db);

    expect(result.catalogId).toBe('catalog-001');
    expect(result.eventId).toBe('event-001');
    expect(result.displayOrder).toBe(1);
  });
});

describe('getFlexCatalog', () => {
  it('vrátí katalog podle ID', async () => {
    const db = makeDb([[makeCatalogRow()]]);

    const result = await getFlexCatalog('catalog-001', db);

    expect(result).not.toBeNull();
    expect(result?.isActive).toBe(true);
  });

  it('vrátí null pro neexistující katalog', async () => {
    const db = makeDb([[]]); // empty

    const result = await getFlexCatalog('nonexistent', db);

    expect(result).toBeNull();
  });
});

describe('listFlexCatalogs', () => {
  it('vrátí všechny katalogy promotéra', async () => {
    const db = makeDb([[
      makeCatalogRow({ id: 'catalog-001' }),
      makeCatalogRow({ id: 'catalog-002', name: 'Basket balíček' }),
    ]]);

    const result = await listFlexCatalogs(PROMOTER_ID, db);

    expect(result).toHaveLength(2);
    expect(result[1].name).toBe('Basket balíček');
  });
});

describe('getCatalogEvents', () => {
  it('vrátí všechny akce v katalogu', async () => {
    const db = makeDb([[
      makeCatalogEventRow({ id: 'ce-001', display_order: 1 }),
      makeCatalogEventRow({ id: 'ce-002', event_id: 'event-002', display_order: 2 }),
    ]]);

    const result = await getCatalogEvents('catalog-001', db);

    expect(result).toHaveLength(2);
    expect(result[0].displayOrder).toBe(1);
  });
});

describe('purchaseFlexPlan', () => {
  it('zakoupí flex plan ve stavu pending_selection', async () => {
    const db = makeDb([
      [makeCatalogRow()],    // getFlexCatalog
      [makePlanRow()],       // INSERT plan
    ]);

    const result = await purchaseFlexPlan(USER_ID, 'catalog-001', 'pay-001', db);

    expect(result.status).toBe('pending_selection');
    expect(result.selectionsLocked).toBe(false);
    expect(result.pricePaidHellers).toBe(499000);
  });

  it('vyhodí CATALOG_NOT_FOUND pro neexistující katalog', async () => {
    const db = makeDb([[]]); // getFlexCatalog returns null

    await expect(purchaseFlexPlan(USER_ID, 'nonexistent', 'pay-001', db))
      .rejects.toThrow('CATALOG_NOT_FOUND');
  });

  it('vyhodí CATALOG_INACTIVE pro neaktivní katalog', async () => {
    const db = makeDb([[makeCatalogRow({ is_active: false })]]);

    await expect(purchaseFlexPlan(USER_ID, 'catalog-001', 'pay-001', db))
      .rejects.toThrow('CATALOG_INACTIVE');
  });
});

describe('getFlexPlan', () => {
  it('vrátí plán uživatele', async () => {
    const db = makeDb([[makePlanRow()]]);

    const result = await getFlexPlan('plan-001', USER_ID, db);

    expect(result).not.toBeNull();
    expect(result?.userId).toBe(USER_ID);
  });

  it('vrátí null pro neexistující plán', async () => {
    const db = makeDb([[]]); // empty

    const result = await getFlexPlan('nonexistent', USER_ID, db);

    expect(result).toBeNull();
  });
});

describe('getPlanSelections', () => {
  it('vrátí výběry aktuálního plánu', async () => {
    const db = makeDb([[
      makeSelectionRow({ id: 'sel-001', event_id: 'event-001' }),
      makeSelectionRow({ id: 'sel-002', event_id: 'event-002', catalog_event_id: 'ce-002' }),
    ]]);

    const result = await getPlanSelections('plan-001', db);

    expect(result).toHaveLength(2);
    expect(result[0].eventId).toBe('event-001');
  });
});
