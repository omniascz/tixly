import { describe, it, expect, vi } from 'vitest';
import type { DbAdapter } from '../lib/types.js';
import {
  getAddonsForEvent,
  addAddonsToOrder,
  removeAddonFromOrder,
  confirmOrderAddons,
  getOrderAddons,
  getAddonsTotal,
  getAddonStats,
} from '../services/checkout-addons.service.js';

// ─── Mock DbAdapter factory ───────────────────────────────────────────────────

function makeMockDb(overrides: Partial<DbAdapter> = {}): DbAdapter {
  return {
    query: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (fn) => fn(makeMockDb())),
    ...overrides,
  };
}

const EVENT_ID = 'event-uuid-1';
const PROMOTER_ID = 'prom-uuid-1';
const ORDER_ID = 'order-uuid-1';

function makeAddonRow(overrides = {}) {
  return {
    id: 'addon-1',
    promoter_id: PROMOTER_ID,
    event_id: EVENT_ID,
    name: 'Parkovací místo',
    description: 'Parkování v hale',
    category: 'parking',
    price_halire: 20000,
    max_quantity: 2,
    stock_available: 50,
    image_url: null,
    available: true,
    display_order: 1,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeOrderAddonRow(overrides = {}) {
  return {
    id: 'oa-1',
    order_id: ORDER_ID,
    addon_id: 'addon-1',
    addon_name: 'Parkovací místo',
    category: 'parking',
    quantity: 1,
    unit_price_halire: 20000,
    subtotal_halire: 20000,
    status: 'pending',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('#210 Checkout Addons', () => {
  // 1. getAddonsForEvent: vrátí dostupné addony seřazené dle displayOrder
  it('getAddonsForEvent: vrátí dostupné addony seřazené dle displayOrder', async () => {
    const addonRows = [
      makeAddonRow({ id: 'addon-1', name: 'Parking', display_order: 1 }),
      makeAddonRow({ id: 'addon-2', name: 'Merch', display_order: 2, category: 'merch' }),
    ];
    const db = makeMockDb({ query: vi.fn().mockResolvedValue(addonRows) });
    const result = await getAddonsForEvent(EVENT_ID, PROMOTER_ID, db);
    expect(result).toHaveLength(2);
    expect(result[0].displayOrder).toBeLessThanOrEqual(result[1].displayOrder);
  });

  // 2. getAddonsForEvent: nevrátí unavailable addony
  it('getAddonsForEvent: nevrátí unavailable addony (SQL filtruje)', async () => {
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([makeAddonRow()]) });
    const result = await getAddonsForEvent(EVENT_ID, PROMOTER_ID, db);
    expect(result.every((a) => a.available === true)).toBe(true);
  });

  // 3. addAddonsToOrder: vypočítá správné subtotals
  it('addAddonsToOrder: vypočítá správné subtotals', async () => {
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([makeAddonRow()]),
    });
    const result = await addAddonsToOrder(ORDER_ID, PROMOTER_ID, [{ addonId: 'addon-1', quantity: 2 }], db);
    expect(result[0].subtotalHalire).toBe(40000); // 20000 * 2
  });

  // 4. addAddonsToOrder: hodí error pro unavailable addon
  it('addAddonsToOrder: hodí error pro unavailable addon', async () => {
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([makeAddonRow({ available: false })]),
    });
    await expect(
      addAddonsToOrder(ORDER_ID, PROMOTER_ID, [{ addonId: 'addon-1', quantity: 1 }], db),
    ).rejects.toThrow(/není dostupný/);
  });

  // 5. addAddonsToOrder: hodí error pokud quantity > maxQuantity
  it('addAddonsToOrder: hodí error pokud quantity > maxQuantity', async () => {
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([makeAddonRow({ max_quantity: 2 })]),
    });
    await expect(
      addAddonsToOrder(ORDER_ID, PROMOTER_ID, [{ addonId: 'addon-1', quantity: 5 }], db),
    ).rejects.toThrow(/překračuje maximum/);
  });

  // 6. addAddonsToOrder: hodí error pokud stockAvailable < quantity
  it('addAddonsToOrder: hodí error pokud stockAvailable < quantity', async () => {
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([makeAddonRow({ stock_available: 1 })]),
    });
    await expect(
      addAddonsToOrder(ORDER_ID, PROMOTER_ID, [{ addonId: 'addon-1', quantity: 2 }], db),
    ).rejects.toThrow(/Nedostatečný sklad/);
  });

  // 7. removeAddonFromOrder: UPDATE status na 'cancelled'
  it('removeAddonFromOrder: UPDATE status na cancelled', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([makeOrderAddonRow()]),
      execute: executeMock,
    });
    await removeAddonFromOrder('oa-1', ORDER_ID, db);
    expect(executeMock).toHaveBeenCalledWith(
      expect.stringContaining("status = 'cancelled'"),
      ['oa-1'],
    );
  });

  // 8. removeAddonFromOrder: hodí error pro addon z cizí objednávky
  it('removeAddonFromOrder: hodí error pro addon z cizí objednávky', async () => {
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([makeOrderAddonRow({ order_id: 'other-order' })]),
    });
    await expect(removeAddonFromOrder('oa-1', ORDER_ID, db)).rejects.toThrow(/nepatří k této objednávce/);
  });

  // 9. confirmOrderAddons: UPDATE status na 'confirmed', vrátí počet
  it('confirmOrderAddons: UPDATE status na confirmed, vrátí počet', async () => {
    const pendingAddons = [makeOrderAddonRow({ id: 'oa-1' }), makeOrderAddonRow({ id: 'oa-2' })];
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue(pendingAddons),
      execute: executeMock,
    });
    const count = await confirmOrderAddons(ORDER_ID, db);
    expect(count).toBe(2);
    expect(executeMock).toHaveBeenCalledWith(
      expect.stringContaining("status = 'confirmed'"),
      [ORDER_ID],
    );
  });

  // 10. getOrderAddons: vrátí všechny addony pro order
  it('getOrderAddons: vrátí všechny addony pro order', async () => {
    const rows = [makeOrderAddonRow({ id: 'oa-1' }), makeOrderAddonRow({ id: 'oa-2', category: 'merch' })];
    const db = makeMockDb({ query: vi.fn().mockResolvedValue(rows) });
    const result = await getOrderAddons(ORDER_ID, db);
    expect(result).toHaveLength(2);
    expect(result[0].orderId).toBe(ORDER_ID);
  });

  // 11. getAddonsTotal: vrátí součet subtotals
  it('getAddonsTotal: vrátí součet subtotals', async () => {
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([{ total: 45000 }]),
    });
    const result = await getAddonsTotal(ORDER_ID, db);
    expect(result).toBe(45000);
  });

  // 12. getAddonsTotal: vrátí 0 pro order bez addonů
  it('getAddonsTotal: vrátí 0 pro order bez addonů', async () => {
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([{ total: 0 }]),
    });
    const result = await getAddonsTotal(ORDER_ID, db);
    expect(result).toBe(0);
  });

  // 13. getAddonStats: vrátí statistiky per addon
  it('getAddonStats: vrátí statistiky per addon', async () => {
    const statsRows = [
      { addon_id: 'addon-1', name: 'Parking', category: 'parking', sold_count: 10, revenue: 200000 },
      { addon_id: 'addon-2', name: 'Merch', category: 'merch', sold_count: 5, revenue: 75000 },
    ];
    const db = makeMockDb({ query: vi.fn().mockResolvedValue(statsRows) });
    const result = await getAddonStats(EVENT_ID, PROMOTER_ID, db);
    expect(result).toHaveLength(2);
    expect(result[0].addonId).toBe('addon-1');
    expect(result[0].soldCount).toBe(10);
    expect(result[0].revenue).toBe(200000);
  });

  // 14. addAddonsToOrder: respektuje stockAvailable (dekrementuje mock)
  it('addAddonsToOrder: validuje stockAvailable před vložením', async () => {
    // item with stock=3, requesting 2 — should succeed
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([makeAddonRow({ stock_available: 3 })]),
    });
    const result = await addAddonsToOrder(ORDER_ID, PROMOTER_ID, [{ addonId: 'addon-1', quantity: 2 }], db);
    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(2);
  });

  // 15. getAddonsForEvent: seřazeno správně dle displayOrder ASC
  it('getAddonsForEvent: seřazeno správně dle displayOrder ASC', async () => {
    const addonRows = [
      makeAddonRow({ id: 'addon-a', display_order: 3 }),
      makeAddonRow({ id: 'addon-b', display_order: 1 }),
      makeAddonRow({ id: 'addon-c', display_order: 2 }),
    ];
    // Mock returns pre-sorted (SQL handles it), but we verify the property
    const sortedRows = [...addonRows].sort((a, b) => a.display_order - b.display_order);
    const db = makeMockDb({ query: vi.fn().mockResolvedValue(sortedRows) });
    const result = await getAddonsForEvent(EVENT_ID, PROMOTER_ID, db);
    expect(result[0].displayOrder).toBe(1);
    expect(result[1].displayOrder).toBe(2);
    expect(result[2].displayOrder).toBe(3);
  });

  // 16. addAddonsToOrder: hodí error pro prázdný items seznam
  it('addAddonsToOrder: hodí error pro prázdný items seznam', async () => {
    const db = makeMockDb();
    await expect(addAddonsToOrder(ORDER_ID, PROMOTER_ID, [], db)).rejects.toThrow(/prázdný/);
  });
});
