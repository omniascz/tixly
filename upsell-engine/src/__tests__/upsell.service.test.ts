import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  addUpsellsToOrder,
  removeUpsellFromOrder,
  createOrganizerUpsell,
} from '../services/upsell.service.js';
import { UpsellError } from '../lib/upsell-errors.js';
import type { DbAdapter, RedisAdapter, KafkaProducerAdapter, ServiceDeps } from '../lib/service-container.js';
import type { UpsellItemRow, UpsellRuleRow, UpsellInventoryRow, UpsellOrderItemRow } from '../types/upsell.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const EVENT_ID      = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORDER_ID      = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER_ID       = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ITEM_ID       = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const RULE_ID       = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const IDEM_KEY      = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const ORDER_ITEM_ID = '11111111-1111-1111-1111-111111111111';

// ─── Factories ────────────────────────────────────────────────────────────────

function makeUpsellItem(overrides: Partial<UpsellItemRow & { event_id: string }> = {}): UpsellItemRow & { event_id: string } {
  return {
    id: ITEM_ID,
    event_id: EVENT_ID,
    type: 'insurance',
    name: 'Travel Insurance',
    description: null,
    price: 19900,
    currency: 'CZK',
    platform_fee_pct: 10,
    image_url: null,
    metadata: {},
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeRule(overrides: Partial<UpsellRuleRow> = {}): UpsellRuleRow {
  return {
    id: RULE_ID,
    upsell_item_id: ITEM_ID,
    ticket_type_id: null,
    timing: 'checkout',
    sort_order: 100,
    max_per_order: null,
    available_from: null,
    available_until: null,
    exclusive_to_ticket_types: [],
    conditions: {},
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeInventory(overrides: Partial<UpsellInventoryRow> = {}): UpsellInventoryRow {
  return {
    upsell_item_id: ITEM_ID,
    total_qty: null,
    sold_count: 0,
    reserved_count: 0,
    low_threshold: 5,
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeOrderItem(overrides: Partial<UpsellOrderItemRow> = {}): UpsellOrderItemRow {
  return {
    id: ORDER_ITEM_ID,
    order_id: ORDER_ID,
    ticket_id: null,
    upsell_item_id: ITEM_ID,
    quantity: 1,
    unit_price: 19900,
    total_price: 19900,
    platform_fee_pct: 10,
    platform_fee_amt: 1990,
    organizer_payout: 17910,
    status: 'pending',
    idempotency_key: IDEM_KEY,
    variant_metadata: {},
    created_at: '2026-04-05T00:00:00Z',
    updated_at: '2026-04-05T00:00:00Z',
    ...overrides,
  };
}

/**
 * Build a ServiceDeps where db.query returns results from the provided queue.
 * The queue is consumed in call order. The same db instance is used both
 * directly and inside transaction (so the queue is shared).
 */
function makeDeps(queryQueue: unknown[][]): ServiceDeps & { kafka: { send: ReturnType<typeof vi.fn> } } {
  const queue = [...queryQueue];

  const db: DbAdapter = {
    query: vi.fn().mockImplementation(async () => queue.shift() ?? []),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) => fn(db)),
  };

  const redis: RedisAdapter = {
    incr: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue(undefined),
  };

  const kafka: KafkaProducerAdapter & { send: ReturnType<typeof vi.fn> } = {
    send: vi.fn().mockResolvedValue(undefined),
  };

  return { db, redis, kafka };
}

// ─── addUpsellsToOrder ────────────────────────────────────────────────────────

describe('addUpsellsToOrder', () => {
  it('throws DUPLICATE_UPSELL on request with existing idempotency key', async () => {
    // idempotency query returns an existing row => short-circuit before transaction
    const deps = makeDeps([
      [makeOrderItem()], // idempotency check — found
    ]);

    await expect(
      addUpsellsToOrder(ORDER_ID, [{ upsellItemId: ITEM_ID, quantity: 1 }], IDEM_KEY, USER_ID, deps),
    ).rejects.toMatchObject({ code: 'DUPLICATE_UPSELL', statusCode: 409 });
  });

  it('successfully adds insurance to order and returns order items', async () => {
    const orderItem = makeOrderItem();
    const deps = makeDeps([
      [],                  // idempotency — not found
      [makeUpsellItem()],  // load upsell item
      [makeRule()],        // load rules
      [makeInventory()],   // FOR UPDATE inventory
      [orderItem],         // INSERT RETURNING
      [makeUpsellItem()],  // post-tx: reload item for kafka
      [makeInventory()],   // post-tx: inventory check for low-stock
    ]);

    const result = await addUpsellsToOrder(
      ORDER_ID,
      [{ upsellItemId: ITEM_ID, quantity: 1 }],
      IDEM_KEY,
      USER_ID,
      deps,
    );

    expect(result.orderItems).toHaveLength(1);
    expect(result.orderItems[0].upsell_item_id).toBe(ITEM_ID);
    expect(result.orderItems[0].status).toBe('pending');
    expect(deps.kafka.send).toHaveBeenCalledWith(
      'upsell.purchased',
      expect.objectContaining({
        eventType: 'upsell.purchased',
        orderId: ORDER_ID,
        upsellItemId: ITEM_ID,
      }),
    );
  });

  it('successfully adds parking per-order upsell (ticketId = null)', async () => {
    const parkingItem = makeUpsellItem({ type: 'parking', price: 30000 });
    const orderItem = makeOrderItem({ ticket_id: null, unit_price: 30000, total_price: 30000 });
    const deps = makeDeps([
      [],
      [parkingItem],
      [makeRule()],
      [makeInventory()],
      [orderItem],
      [parkingItem],
      [makeInventory()],
    ]);

    const result = await addUpsellsToOrder(
      ORDER_ID,
      [{ upsellItemId: ITEM_ID, quantity: 1 }],
      IDEM_KEY,
      USER_ID,
      deps,
    );

    expect(result.orderItems[0].ticket_id).toBeNull();
  });

  it('adds F&B voucher with quantity > 1 and correct total in halire', async () => {
    const fnbItem = makeUpsellItem({ type: 'fnb_voucher', price: 5000 });
    const orderItem = makeOrderItem({
      quantity: 3,
      unit_price: 5000,
      total_price: 15000,
      platform_fee_amt: 1500,
      organizer_payout: 13500,
    });
    const deps = makeDeps([
      [],
      [fnbItem],
      [makeRule({ max_per_order: 5 })],
      [makeInventory({ total_qty: 100 })],
      [orderItem],
      [fnbItem],
      [makeInventory({ total_qty: 100, reserved_count: 3 })],
    ]);

    const result = await addUpsellsToOrder(
      ORDER_ID,
      [{ upsellItemId: ITEM_ID, quantity: 3 }],
      IDEM_KEY,
      USER_ID,
      deps,
    );

    expect(result.orderItems[0].quantity).toBe(3);
    expect(result.orderItems[0].total_price).toBe(15000);
    expect(result.orderItems[0].platform_fee_amt).toBe(1500);
    expect(result.orderItems[0].organizer_payout).toBe(13500);
  });

  it('throws UPSELL_SOLD_OUT when inventory is exhausted', async () => {
    const deps = makeDeps([
      [],
      [makeUpsellItem()],
      [makeRule()],
      [makeInventory({ total_qty: 5, sold_count: 5, reserved_count: 0 })],
    ]);

    await expect(
      addUpsellsToOrder(ORDER_ID, [{ upsellItemId: ITEM_ID, quantity: 1 }], IDEM_KEY, USER_ID, deps),
    ).rejects.toMatchObject({ code: 'UPSELL_SOLD_OUT', statusCode: 409 });
  });

  it('throws MAX_PER_ORDER_EXCEEDED when requested quantity exceeds max_per_order', async () => {
    const deps = makeDeps([
      [],
      [makeUpsellItem()],
      [makeRule({ max_per_order: 2 })],
      [makeInventory()],
    ]);

    await expect(
      addUpsellsToOrder(ORDER_ID, [{ upsellItemId: ITEM_ID, quantity: 5 }], IDEM_KEY, USER_ID, deps),
    ).rejects.toMatchObject({ code: 'MAX_PER_ORDER_EXCEEDED', statusCode: 422 });
  });

  it('throws TIME_WINDOW_CLOSED when all rules are past available_until', async () => {
    const deps = makeDeps([
      [],
      [makeUpsellItem()],
      [makeRule({ available_from: '2019-01-01T00:00:00Z', available_until: '2020-01-01T00:00:00Z' })],
    ]);

    await expect(
      addUpsellsToOrder(ORDER_ID, [{ upsellItemId: ITEM_ID, quantity: 1 }], IDEM_KEY, USER_ID, deps),
    ).rejects.toMatchObject({ code: 'TIME_WINDOW_CLOSED', statusCode: 422 });
  });

  it('throws UPSELL_NOT_FOUND when upsell item does not exist', async () => {
    const deps = makeDeps([
      [],  // idempotency — not found
      [],  // upsell item — not found
    ]);

    await expect(
      addUpsellsToOrder(ORDER_ID, [{ upsellItemId: ITEM_ID, quantity: 1 }], IDEM_KEY, USER_ID, deps),
    ).rejects.toMatchObject({ code: 'UPSELL_NOT_FOUND', statusCode: 404 });
  });

  it('emits kafka upsell.purchased event on successful purchase', async () => {
    const meetGreetItem = makeUpsellItem({ type: 'meet_greet' });
    const orderItem = makeOrderItem();
    const deps = makeDeps([
      [],
      [meetGreetItem],
      [makeRule()],
      [makeInventory()],
      [orderItem],
      [meetGreetItem],
      [makeInventory()],
    ]);

    await addUpsellsToOrder(
      ORDER_ID,
      [{ upsellItemId: ITEM_ID, quantity: 1 }],
      IDEM_KEY,
      USER_ID,
      deps,
    );

    expect(deps.kafka.send).toHaveBeenCalledWith(
      'upsell.purchased',
      expect.objectContaining({
        eventType: 'upsell.purchased',
        upsellType: 'meet_greet',
        userId: USER_ID,
        eventId: EVENT_ID,
      }),
    );
  });

  it('emits upsell.inventory.low when remaining qty <= low_threshold after purchase', async () => {
    const item = makeUpsellItem();
    const orderItem = makeOrderItem();
    // After reservation: total=10, sold=5, reserved=5 => remaining=0 <= threshold=2
    const lowInv = makeInventory({ total_qty: 10, sold_count: 5, reserved_count: 5, low_threshold: 2 });

    const deps = makeDeps([
      [],
      [item],
      [makeRule()],
      [makeInventory({ total_qty: 10, sold_count: 5, reserved_count: 4 })],
      [orderItem],
      [item],
      [lowInv],
    ]);

    await addUpsellsToOrder(
      ORDER_ID,
      [{ upsellItemId: ITEM_ID, quantity: 1 }],
      IDEM_KEY,
      USER_ID,
      deps,
    );

    expect(deps.kafka.send).toHaveBeenCalledWith(
      'upsell.inventory.low',
      expect.objectContaining({
        eventType: 'upsell.inventory.low',
        upsellItemId: ITEM_ID,
        eventId: EVENT_ID,
        remaining: 0,
      }),
    );
  });

  it('does NOT emit inventory.low when remaining > low_threshold', async () => {
    const item = makeUpsellItem();
    const orderItem = makeOrderItem();
    // remaining = 100 - 0 - 1 = 99, threshold = 5 => no alert
    const healthyInv = makeInventory({ total_qty: 100, sold_count: 0, reserved_count: 1, low_threshold: 5 });

    const deps = makeDeps([
      [],
      [item],
      [makeRule()],
      [makeInventory({ total_qty: 100, sold_count: 0, reserved_count: 0 })],
      [orderItem],
      [item],
      [healthyInv],
    ]);

    await addUpsellsToOrder(
      ORDER_ID,
      [{ upsellItemId: ITEM_ID, quantity: 1 }],
      IDEM_KEY,
      USER_ID,
      deps,
    );

    const lowCalls = (deps.kafka.send as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => c[0] === 'upsell.inventory.low');
    expect(lowCalls).toHaveLength(0);
  });

  it('race condition: capacity=1, second request sees sold-out inventory', async () => {
    const IDEM_KEY2 = '22222222-2222-2222-2222-222222222222';

    // First request succeeds
    const deps1 = makeDeps([
      [],
      [makeUpsellItem()],
      [makeRule()],
      [makeInventory({ total_qty: 1, sold_count: 0, reserved_count: 0 })],
      [makeOrderItem()],
      [makeUpsellItem()],
      [makeInventory({ total_qty: 1, sold_count: 0, reserved_count: 1, low_threshold: 1 })],
    ]);

    const result1 = await addUpsellsToOrder(
      ORDER_ID,
      [{ upsellItemId: ITEM_ID, quantity: 1 }],
      IDEM_KEY,
      USER_ID,
      deps1,
    );
    expect(result1.orderItems).toHaveLength(1);

    // Second request: row-level lock shows fully reserved inventory
    const deps2 = makeDeps([
      [],
      [makeUpsellItem()],
      [makeRule()],
      [makeInventory({ total_qty: 1, sold_count: 0, reserved_count: 1 })],
    ]);

    await expect(
      addUpsellsToOrder(ORDER_ID, [{ upsellItemId: ITEM_ID, quantity: 1 }], IDEM_KEY2, USER_ID, deps2),
    ).rejects.toMatchObject({ code: 'UPSELL_SOLD_OUT' });
  });
});

// ─── removeUpsellFromOrder ────────────────────────────────────────────────────

describe('removeUpsellFromOrder', () => {
  it('cancels a pending upsell order item and decrements reserved_count', async () => {
    const pendingItem = makeOrderItem({ status: 'pending' });
    const deps = makeDeps([
      [pendingItem], // FOR UPDATE select inside transaction
    ]);

    await removeUpsellFromOrder(ORDER_ID, ORDER_ITEM_ID, USER_ID, deps);

    const executeCalls = (deps.db.execute as ReturnType<typeof vi.fn>).mock.calls;
    const releaseCall = executeCalls.find((c: unknown[]) => (c[0] as string).includes('reserved_count'));
    expect(releaseCall).toBeDefined();
    expect(releaseCall![1]).toEqual(expect.arrayContaining([pendingItem.quantity, ITEM_ID]));

    const cancelCall = executeCalls.find((c: unknown[]) => (c[0] as string).includes("status = 'cancelled'"));
    expect(cancelCall).toBeDefined();
  });

  it('throws UPSELL_NOT_AVAILABLE when trying to cancel a paid upsell', async () => {
    const paidItem = makeOrderItem({ status: 'paid' });
    const deps = makeDeps([
      [paidItem],
    ]);

    await expect(
      removeUpsellFromOrder(ORDER_ID, ORDER_ITEM_ID, USER_ID, deps),
    ).rejects.toMatchObject({ code: 'UPSELL_NOT_AVAILABLE', statusCode: 422 });
  });

  it('throws ORDER_NOT_FOUND when upsell order item does not exist', async () => {
    const deps = makeDeps([
      [], // not found
    ]);

    await expect(
      removeUpsellFromOrder(ORDER_ID, ORDER_ITEM_ID, USER_ID, deps),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND', statusCode: 404 });
  });
});

// ─── createOrganizerUpsell ────────────────────────────────────────────────────

describe('createOrganizerUpsell', () => {
  it('creates upsell item + rule + inventory in a transaction', async () => {
    const vipItem = makeUpsellItem({ type: 'vip_upgrade', name: 'VIP Upgrade', price: 150000 });
    const rule = makeRule({ timing: 'checkout', sort_order: 10 });
    const inv = makeInventory({ total_qty: 50, low_threshold: 5 });

    const deps = makeDeps([
      [vipItem],  // INSERT item RETURNING
      [rule],     // INSERT rule RETURNING
      [inv],      // INSERT inventory RETURNING
    ]);

    const result = await createOrganizerUpsell(
      EVENT_ID,
      {
        type: 'vip_upgrade',
        name: 'VIP Upgrade',
        price: 150000,
        currency: 'CZK',
        totalQty: 50,
        lowThreshold: 5,
        rules: [{ timing: 'checkout', sortOrder: 10 }],
      },
      deps,
    );

    expect(result.id).toBe(ITEM_ID);
    expect(result.type).toBe('vip_upgrade');
    expect(result.totalQty).toBe(50);
    expect(result.soldCount).toBe(0);
    expect(result.reservedCount).toBe(0);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].timing).toBe('checkout');
    expect(result.rules[0].sortOrder).toBe(10); // from makeRule override
  });
});
