import { describe, it, expect, vi } from 'vitest';
import {
  onboardRetailer,
  allocateInventory,
  processRetailerSale,
  settlementDay,
  listRetailers,
  getRetailerAllocations,
} from '../services/retailer.service.js';
import type { DbAdapter } from '../services/retailer.service.js';

function makeRetailerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'retailer-001',
    name: 'Knihkupectví Světozor',
    contact_name: 'Jan Procházka',
    contact_email: 'jan@knizkupec.cz',
    contact_phone: '+420777123456',
    address: 'Václavské náměstí 1',
    city: 'Praha',
    country: 'CZ',
    ico: '12345678',
    commission_pct: '5.00',
    api_key: 'abc123def456',
    status: 'active',
    created_at: '2026-04-14T08:00:00Z',
    updated_at: '2026-04-14T08:00:00Z',
    ...overrides,
  };
}

function makeAllocationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alloc-001',
    retailer_id: 'retailer-001',
    event_id: 'event-001',
    ticket_type_id: 'tt-001',
    allocated_qty: 50,
    sold_qty: 0,
    returned_qty: 0,
    valid_from: '2026-04-14T08:00:00Z',
    valid_until: null,
    ...overrides,
  };
}

function makeSaleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sale-001',
    retailer_id: 'retailer-001',
    allocation_id: 'alloc-001',
    ticket_id: 'ticket-001',
    order_id: null,
    sale_price_hellers: 100000,
    commission_hellers: 5000,
    sold_at: '2026-04-14T12:00:00Z',
    settlement_id: null,
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

describe('onboardRetailer', () => {
  it('vytvoří nového retailera', async () => {
    const db = makeDb([[makeRetailerRow()]]);
    const result = await onboardRetailer({
      name: 'Knihkupectví Světozor',
      contactName: 'Jan Procházka',
      contactEmail: 'jan@knizkupec.cz',
      city: 'Praha',
    }, db);

    expect(result.name).toBe('Knihkupectví Světozor');
    expect(result.commissionPct).toBe(5.0);
    expect(result.status).toBe('active');
    expect(result.country).toBe('CZ');
  });

  it('odmítne prázdné jméno', async () => {
    const db = makeDb();
    await expect(onboardRetailer({
      name: '   ', contactName: 'Jan', contactEmail: 'jan@test.cz', city: 'Praha',
    }, db)).rejects.toThrow('name is required');
  });

  it('odmítne neplatný email', async () => {
    const db = makeDb();
    await expect(onboardRetailer({
      name: 'Prodejna', contactName: 'Jan', contactEmail: 'not-email', city: 'Praha',
    }, db)).rejects.toThrow('invalid email');
  });

  it('odmítne commission mimo rozsah', async () => {
    const db = makeDb();
    await expect(onboardRetailer({
      name: 'Prodejna', contactName: 'Jan', contactEmail: 'j@test.cz', city: 'Praha',
      commissionPct: 35,
    }, db)).rejects.toThrow('commissionPct must be between 0 and 30');
  });

  it('přijme commissionPct 0', async () => {
    const db = makeDb([[makeRetailerRow({ commission_pct: '0.00' })]]);
    const result = await onboardRetailer({
      name: 'Prodejna', contactName: 'Jan', contactEmail: 'j@test.cz', city: 'Praha',
      commissionPct: 0,
    }, db);
    expect(result.commissionPct).toBe(0);
  });
});

describe('allocateInventory', () => {
  it('přidělí inventory retailerovi', async () => {
    const db = makeDb([
      [makeRetailerRow()],        // active retailer check
      [makeAllocationRow({ allocated_qty: 50 })],
    ]);

    const result = await allocateInventory('retailer-001', 'event-001', 'tt-001', 50, null, db);
    expect(result.allocatedQty).toBe(50);
    expect(result.availableQty).toBe(50); // sold=0, returned=0
  });

  it('odmítne záporné množství', async () => {
    const db = makeDb();
    await expect(allocateInventory('r', 'e', 'tt', -1, null, db))
      .rejects.toThrow('allocatedQty must be >= 0');
  });

  it('odmítne neaktivního retailera', async () => {
    const db = makeDb([[]]); // empty = not found
    await expect(allocateInventory('r', 'e', 'tt', 10, null, db))
      .rejects.toThrow('RETAILER_NOT_FOUND');
  });
});

describe('processRetailerSale', () => {
  it('zaznamená prodej a spočítá provizi', async () => {
    const db = makeDb([
      [makeRetailerRow({ commission_pct: '5.00' })],
      [makeAllocationRow({ sold_qty: 1 })],   // after atomic increment
      [makeSaleRow({ commission_hellers: 5000 })],
    ]);

    const result = await processRetailerSale('retailer-001', 'tt-001', 'ticket-001', null, 100000, db);
    expect(result.salePriceHellers).toBe(100000);
    expect(result.commissionHellers).toBe(5000);
  });

  it('odmítne nulovou cenu', async () => {
    const db = makeDb();
    await expect(processRetailerSale('r', 'tt', 'tick', null, 0, db))
      .rejects.toThrow('salePriceHellers must be positive');
  });

  it('odmítne prodej pokud je allocation vyčerpána', async () => {
    const db = makeDb([
      [makeRetailerRow()],
      [],    // empty = atomic update returned nothing
    ]);
    await expect(processRetailerSale('retailer-001', 'tt-001', 'ticket-001', null, 100000, db))
      .rejects.toThrow('ALLOCATION_EXHAUSTED');
  });

  it('odmítne neaktivního retailera', async () => {
    const db = makeDb([[]]); // empty = not active
    await expect(processRetailerSale('r', 'tt', 'tick', null, 100, db))
      .rejects.toThrow('RETAILER_NOT_FOUND');
  });

  it('spočítá provizi s desetinným procentem', async () => {
    const db = makeDb([
      [makeRetailerRow({ commission_pct: '7.50' })],
      [makeAllocationRow({ sold_qty: 1 })],
      [makeSaleRow({ commission_hellers: 750 })],
    ]);
    const result = await processRetailerSale('retailer-001', 'tt-001', 'ticket-001', null, 10000, db);
    // 10000 * 7.5% = 750
    expect(result.commissionHellers).toBe(750);
  });
});

describe('settlementDay', () => {
  it('vytvoří denní vypořádání', async () => {
    const db = makeDb([
      [{ total_sales: '5', gross_amount_hellers: '500000', commission_hellers: '25000' }],
      [{
        id: 'settlement-001',
        retailer_id: 'retailer-001',
        settlement_date: '2026-04-14',
        total_sales: 5,
        gross_amount_hellers: '500000',
        commission_hellers: '25000',
        net_amount_hellers: '475000',
        status: 'pending',
        created_at: '2026-04-14T23:00:00Z',
      }],
    ]);

    const result = await settlementDay('retailer-001', '2026-04-14', db);
    expect(result.totalSales).toBe(5);
    expect(result.grossAmountHellers).toBe(500000);
    expect(result.commissionHellers).toBe(25000);
    expect(result.netAmountHellers).toBe(475000);
    expect(result.status).toBe('pending');
    expect(db.execute).toHaveBeenCalledOnce(); // link sales to settlement
  });

  it('vrátí nulové vypořádání pro den bez prodejů', async () => {
    const db = makeDb([
      [{ total_sales: '0', gross_amount_hellers: '0', commission_hellers: '0' }],
      [{
        id: 'settlement-002',
        retailer_id: 'retailer-001',
        settlement_date: '2026-04-14',
        total_sales: 0,
        gross_amount_hellers: '0',
        commission_hellers: '0',
        net_amount_hellers: '0',
        status: 'pending',
        created_at: '2026-04-14T23:00:00Z',
      }],
    ]);

    const result = await settlementDay('retailer-001', '2026-04-14', db);
    expect(result.totalSales).toBe(0);
    expect(result.netAmountHellers).toBe(0);
  });
});

describe('listRetailers', () => {
  it('vrátí všechny aktivní retailery', async () => {
    const db = makeDb([[makeRetailerRow(), makeRetailerRow({ id: 'retailer-002', name: 'Prodejna 2' })]]);
    const result = await listRetailers('active', db);
    expect(result).toHaveLength(2);
  });

  it('vrátí všechny retailery bez filtru', async () => {
    const db = makeDb([[makeRetailerRow(), makeRetailerRow({ id: 'r2', status: 'suspended' })]]);
    const result = await listRetailers(null, db);
    expect(result).toHaveLength(2);
  });
});

describe('getRetailerAllocations', () => {
  it('vrátí alokace retailera pro event', async () => {
    const db = makeDb([[makeAllocationRow(), makeAllocationRow({ id: 'alloc-002', ticket_type_id: 'tt-002' })]]);
    const result = await getRetailerAllocations('retailer-001', 'event-001', db);
    expect(result).toHaveLength(2);
    expect(result[0].availableQty).toBe(50);
  });
});
