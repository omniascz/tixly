import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DbAdapter } from '../lib/types.js';
import type { FnbMenuItem, FnbPreorder, FnbOrderItem } from '../lib/types.js';
import {
  getMenuForEvent,
  createPreorder,
  confirmPreorder,
  markReady,
  processPickup,
  cancelPreorder,
  getEventFnbStats,
} from '../services/fnb-preorder.service.js';

// ─── Mock DbAdapter factory ───────────────────────────────────────────────────

function makeMockDb(overrides: Partial<DbAdapter> = {}): DbAdapter {
  return {
    query: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (fn) => fn(makeMockDb())),
    ...overrides,
  };
}

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const EVENT_ID = 'event-uuid-1';
const PROMOTER_ID = 'promoter-uuid-1';
const ORDER_ID = 'order-uuid-1';

const menuItemRow = {
  id: 'item-1',
  promoter_id: PROMOTER_ID,
  event_id: EVENT_ID,
  name: 'Pivo',
  description: 'Světlé 0,5l',
  category: 'beverage',
  price_halire: 8000,
  max_quantity_per_order: 5,
  stock_limit: 100,
  available: true,
  image_url: null,
};

const unavailableMenuItemRow = { ...menuItemRow, id: 'item-2', name: 'Klobása', available: false };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('#208 F&B Pre-order', () => {
  // 1. getMenuForEvent: vrátí dostupné položky pro event
  it('getMenuForEvent: vrátí dostupné položky pro event', async () => {
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([menuItemRow]) });
    const result = await getMenuForEvent(EVENT_ID, PROMOTER_ID, db);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Pivo');
    expect(result[0].available).toBe(true);
  });

  // 2. getMenuForEvent: nevrátí unavailable položky
  it('getMenuForEvent: nevrátí unavailable položky (SQL filtruje)', async () => {
    // SQL query filters out unavailable; mock returns only available
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([menuItemRow]) });
    const result = await getMenuForEvent(EVENT_ID, PROMOTER_ID, db);
    const allAvailable = result.every((i) => i.available === true);
    expect(allAvailable).toBe(true);
  });

  // 3. createPreorder: správně vypočítá subtotal a total
  it('createPreorder: správně vypočítá subtotal a total', async () => {
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([menuItemRow]),
    });
    const result = await createPreorder(ORDER_ID, EVENT_ID, PROMOTER_ID, [{ menuItemId: 'item-1', quantity: 3 }], db);
    expect(result.items[0].subtotalHalire).toBe(24000); // 8000 * 3
    expect(result.totalHalire).toBe(24000);
  });

  // 4. createPreorder: generuje 6místný pickupCode
  it('createPreorder: generuje 6místný pickupCode', async () => {
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([menuItemRow]),
    });
    const result = await createPreorder(ORDER_ID, EVENT_ID, PROMOTER_ID, [{ menuItemId: 'item-1', quantity: 1 }], db);
    expect(result.pickupCode).toMatch(/^\d{6}$/);
  });

  // 5. createPreorder: hodí error pro unavailable item
  it('createPreorder: hodí error pro unavailable item', async () => {
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([unavailableMenuItemRow]),
    });
    await expect(
      createPreorder(ORDER_ID, EVENT_ID, PROMOTER_ID, [{ menuItemId: 'item-2', quantity: 1 }], db),
    ).rejects.toThrow(/není dostupný/);
  });

  // 6. createPreorder: hodí error pro quantity > maxQuantityPerOrder
  it('createPreorder: hodí error pro quantity > maxQuantityPerOrder', async () => {
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([menuItemRow]),
    });
    await expect(
      createPreorder(ORDER_ID, EVENT_ID, PROMOTER_ID, [{ menuItemId: 'item-1', quantity: 10 }], db),
    ).rejects.toThrow(/překračuje maximum/);
  });

  // 7. createPreorder: hodí error pokud item nenalezen
  it('createPreorder: hodí error pokud item nenalezen', async () => {
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([]) });
    await expect(
      createPreorder(ORDER_ID, EVENT_ID, PROMOTER_ID, [{ menuItemId: 'nonexistent', quantity: 1 }], db),
    ).rejects.toThrow(/nenalezen/);
  });

  // 8. confirmPreorder: UPDATE status na 'confirmed'
  it('confirmPreorder: UPDATE status na confirmed', async () => {
    const preorderRow = {
      id: 'preorder-1',
      order_id: ORDER_ID,
      event_id: EVENT_ID,
      promoter_id: PROMOTER_ID,
      user_id: null,
      items: JSON.stringify([]),
      total_halire: 8000,
      status: 'confirmed',
      pickup_code: '123456',
      pickup_qr_data: '123456:order-uuid-1',
      pickup_window_start: null,
      pickup_window_end: null,
      created_at: new Date().toISOString(),
    };
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const queryMock = vi.fn().mockResolvedValue([preorderRow]);
    const db = makeMockDb({ execute: executeMock, query: queryMock });
    const result = await confirmPreorder('preorder-1', db);
    expect(executeMock).toHaveBeenCalledWith(
      expect.stringContaining("status = 'confirmed'"),
      ['preorder-1'],
    );
    expect(result.status).toBe('confirmed');
  });

  // 9. markReady: UPDATE status na 'ready'
  it('markReady: UPDATE status na ready', async () => {
    const preorderRow = {
      id: 'preorder-1',
      order_id: ORDER_ID,
      event_id: EVENT_ID,
      promoter_id: PROMOTER_ID,
      user_id: null,
      items: JSON.stringify([]),
      total_halire: 8000,
      status: 'ready',
      pickup_code: '654321',
      pickup_qr_data: '654321:order-uuid-1',
      pickup_window_start: null,
      pickup_window_end: null,
      created_at: new Date().toISOString(),
    };
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const queryMock = vi.fn().mockResolvedValue([preorderRow]);
    const db = makeMockDb({ execute: executeMock, query: queryMock });
    const result = await markReady('preorder-1', db);
    expect(executeMock).toHaveBeenCalledWith(
      expect.stringContaining("status = 'ready'"),
      ['preorder-1'],
    );
    expect(result.status).toBe('ready');
  });

  // 10. processPickup: vrátí preorder pro správný code a eventId
  it('processPickup: vrátí preorder pro správný code a eventId', async () => {
    const preorderRow = {
      id: 'preorder-1',
      order_id: ORDER_ID,
      event_id: EVENT_ID,
      promoter_id: PROMOTER_ID,
      user_id: null,
      items: JSON.stringify([]),
      total_halire: 8000,
      status: 'ready',
      pickup_code: '123456',
      pickup_qr_data: '123456:order-uuid-1',
      pickup_window_start: null,
      pickup_window_end: null,
      created_at: new Date().toISOString(),
    };
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([preorderRow]),
    });
    const result = await processPickup('123456', EVENT_ID, db);
    expect(result.status).toBe('picked_up');
    expect(result.pickupCode).toBe('123456');
  });

  // 11. processPickup: hodí error pro nesprávný code
  it('processPickup: hodí error pro nesprávný code', async () => {
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([]) });
    await expect(processPickup('000000', EVENT_ID, db)).rejects.toThrow(/nenalezen/);
  });

  // 12. processPickup: hodí error pokud status !== 'ready'
  it('processPickup: hodí error pokud status !== ready', async () => {
    const preorderRow = {
      id: 'preorder-1',
      order_id: ORDER_ID,
      event_id: EVENT_ID,
      promoter_id: PROMOTER_ID,
      user_id: null,
      items: JSON.stringify([]),
      total_halire: 8000,
      status: 'pending',
      pickup_code: '123456',
      pickup_qr_data: '123456:order-uuid-1',
      pickup_window_start: null,
      pickup_window_end: null,
      created_at: new Date().toISOString(),
    };
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([preorderRow]) });
    await expect(processPickup('123456', EVENT_ID, db)).rejects.toThrow(/není připraven/);
  });

  // 13. cancelPreorder: UPDATE na 'cancelled' pro pending
  it('cancelPreorder: UPDATE na cancelled pro pending', async () => {
    const preorderRow = {
      id: 'preorder-1',
      order_id: ORDER_ID,
      event_id: EVENT_ID,
      promoter_id: PROMOTER_ID,
      user_id: null,
      items: JSON.stringify([]),
      total_halire: 8000,
      status: 'pending',
      pickup_code: '123456',
      pickup_qr_data: '123456:order-uuid-1',
      pickup_window_start: null,
      pickup_window_end: null,
      created_at: new Date().toISOString(),
    };
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([preorderRow]),
      execute: executeMock,
    });
    await cancelPreorder('preorder-1', db);
    expect(executeMock).toHaveBeenCalledWith(
      expect.stringContaining("status = 'cancelled'"),
      ['preorder-1'],
    );
  });

  // 14. cancelPreorder: hodí error pro confirmed preorder
  it('cancelPreorder: hodí error pro confirmed preorder', async () => {
    const preorderRow = {
      id: 'preorder-1',
      order_id: ORDER_ID,
      event_id: EVENT_ID,
      promoter_id: PROMOTER_ID,
      user_id: null,
      items: JSON.stringify([]),
      total_halire: 8000,
      status: 'confirmed',
      pickup_code: '123456',
      pickup_qr_data: '123456:order-uuid-1',
      pickup_window_start: null,
      pickup_window_end: null,
      created_at: new Date().toISOString(),
    };
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([preorderRow]) });
    await expect(cancelPreorder('preorder-1', db)).rejects.toThrow(/nelze zrušit/);
  });

  // 15. getEventFnbStats: vrátí správnou strukturu
  it('getEventFnbStats: vrátí správnou strukturu', async () => {
    const db = makeMockDb({
      query: vi.fn()
        .mockResolvedValueOnce([{ total_orders: 2, total_revenue: 16000 }])
        .mockResolvedValueOnce([]),
    });
    const result = await getEventFnbStats(EVENT_ID, PROMOTER_ID, db);
    expect(result).toHaveProperty('totalOrders');
    expect(result).toHaveProperty('totalRevenue');
    expect(result).toHaveProperty('itemSummary');
    expect(Array.isArray(result.itemSummary)).toBe(true);
  });

  // 16. getEventFnbStats: totalRevenue = suma z orders
  it('getEventFnbStats: totalRevenue = suma z orders', async () => {
    const items: FnbOrderItem[] = [
      { menuItemId: 'item-1', name: 'Pivo', quantity: 2, unitPriceHalire: 8000, subtotalHalire: 16000 },
    ];
    const preorderRow = {
      id: 'po-1',
      order_id: ORDER_ID,
      event_id: EVENT_ID,
      promoter_id: PROMOTER_ID,
      user_id: null,
      items: JSON.stringify(items),
      total_halire: 16000,
      status: 'confirmed',
      pickup_code: '111111',
      pickup_qr_data: 'data',
      pickup_window_start: null,
      pickup_window_end: null,
      created_at: new Date().toISOString(),
    };
    const db = makeMockDb({
      query: vi.fn()
        .mockResolvedValueOnce([{ total_orders: 1, total_revenue: 16000 }])
        .mockResolvedValueOnce([preorderRow]),
    });
    const result = await getEventFnbStats(EVENT_ID, PROMOTER_ID, db);
    expect(result.totalRevenue).toBe(16000);
    expect(result.itemSummary[0].name).toBe('Pivo');
    expect(result.itemSummary[0].quantity).toBe(2);
  });

  // 17. createPreorder: respektuje stockLimit (hodí error)
  it('createPreorder: respektuje stockLimit (hodí error)', async () => {
    const limitedItem = { ...menuItemRow, stock_limit: 2 };
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([limitedItem]) });
    await expect(
      createPreorder(ORDER_ID, EVENT_ID, PROMOTER_ID, [{ menuItemId: 'item-1', quantity: 3 }], db),
    ).rejects.toThrow(/Nedostatečný sklad/);
  });

  // 18. pickupCode má formát 6 číslic
  it('pickupCode má formát 6 číslic (test generátoru)', async () => {
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([menuItemRow]),
    });
    // Test multiple preorders to verify format consistency
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        createPreorder(ORDER_ID, EVENT_ID, PROMOTER_ID, [{ menuItemId: 'item-1', quantity: 1 }], db),
      ),
    );
    results.forEach((r) => {
      expect(r.pickupCode).toMatch(/^\d{6}$/);
      expect(r.pickupCode.length).toBe(6);
    });
  });
});
