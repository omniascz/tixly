import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  reserveMerchandise,
  cancelMerchandiseItem,
  createProduct,
  archiveProduct,
  getInventory,
  getProductsForEvent,
} from '../services/merchandise.service';
import { MerchandiseError } from '../lib/merchandise-errors';
import type { DbAdapter, KafkaProducerAdapter, ServiceDeps } from '../lib/service-container';
import type { VariantRow, ProductRow, OrderItemRow } from '../types/merchandise';

// ─── Factories ────────────────────────────────────────────────────────────────

function makeProduct(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: 'prod-1',
    event_id: 'event-1',
    organizer_id: 'org-1',
    name: 'Test T-shirt',
    description: null,
    base_price: 59900,
    currency: 'CZK',
    fulfillment: 'pickup_at_venue',
    image_urls: [],
    metadata: {},
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeVariant(overrides: Partial<VariantRow> = {}): VariantRow & {
  base_price: number;
  fulfillment: string;
  currency: string;
} {
  return {
    id: 'variant-1',
    product_id: 'prod-1',
    sku: 'TSHIRT-M-BLACK',
    name: 'M / Černá',
    price_modifier: 0,
    total_qty: 100,
    sold_count: 0,
    reserved_count: 0,
    low_threshold: 3,
    attributes: { size: 'M', color: 'black' },
    is_active: true,
    created_at: new Date().toISOString(),
    base_price: 59900,
    fulfillment: 'pickup_at_venue',
    currency: 'CZK',
    ...overrides,
  };
}

function makeOrderItem(overrides: Partial<OrderItemRow> = {}): OrderItemRow {
  return {
    id: 'item-1',
    order_id: 'order-1',
    product_id: 'prod-1',
    variant_id: 'variant-1',
    quantity: 1,
    unit_price: 59900,
    total_price: 59900,
    fulfillment: 'pickup_at_venue',
    status: 'pending',
    shipping_address: null,
    tracking_number: null,
    idempotency_key: '550e8400-e29b-41d4-a716-446655440000',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Mock builders ────────────────────────────────────────────────────────────

function makeDeps(overrides: {
  queryResults?: unknown[][];
  executeImpl?: ReturnType<typeof vi.fn>;
  kafkaSend?: ReturnType<typeof vi.fn>;
  transactionImpl?: (fn: (tx: DbAdapter) => Promise<unknown>) => Promise<unknown>;
}): ServiceDeps & { mockKafka: KafkaProducerAdapter; mockDb: DbAdapter } {
  let queryCallCount = 0;
  const queryResults = overrides.queryResults ?? [];

  const mockExecute = overrides.executeImpl ?? vi.fn().mockResolvedValue(undefined);
  const mockKafkaSend = overrides.kafkaSend ?? vi.fn().mockResolvedValue(undefined);

  const mockDb: DbAdapter = {
    query: vi.fn().mockImplementation(() => {
      const result = queryResults[queryCallCount] ?? [];
      queryCallCount++;
      return Promise.resolve(result);
    }),
    execute: mockExecute,
    transaction: overrides.transactionImpl
      ? (fn) => overrides.transactionImpl!(fn)
      : vi.fn().mockImplementation((fn) => fn(mockDb)),
  };

  const mockKafka: KafkaProducerAdapter = {
    send: mockKafkaSend,
  };

  return { db: mockDb, kafka: mockKafka, mockKafka, mockDb };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('reserveMerchandise', () => {
  it('successful reservation (pickup_at_venue)', async () => {
    const variant = makeVariant({ fulfillment: 'pickup_at_venue' });
    const orderItem = makeOrderItem();

    const deps = makeDeps({
      // call 0: idempotency check (outer query) → no duplicate
      // call 1: FOR UPDATE variant query (in transaction)
      // call 2: INSERT order_item (in transaction)
      // call 3: post-reservation low-stock check (outer query)
      queryResults: [[], [variant], [orderItem], [{ ...variant, reserved_count: 1 }]],
    });

    const result = await reserveMerchandise(
      'order-1',
      [{ variantId: 'variant-1', quantity: 1 }],
      '550e8400-e29b-41d4-a716-446655440000',
      deps,
    );

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('pending');
    expect(result[0].unit_price).toBe(59900);
    expect(deps.mockKafka.send).toHaveBeenCalledWith('merchandise.reserved', expect.objectContaining({
      eventType: 'merchandise.reserved',
      orderId: 'order-1',
    }));
  });

  it('successful reservation (shipping with address)', async () => {
    const variant = makeVariant({ fulfillment: 'shipping' });
    const orderItem = makeOrderItem({ fulfillment: 'shipping', shipping_address: {
      name: 'Jan Novák',
      street: 'Náměstí 1',
      city: 'Praha',
      postalCode: '11000',
      country: 'CZ',
    }});

    const deps = makeDeps({
      queryResults: [[], [variant], [orderItem], [{ ...variant, reserved_count: 1 }]],
    });

    const shippingAddress = {
      name: 'Jan Novák',
      street: 'Náměstí 1',
      city: 'Praha',
      postalCode: '11000',
      country: 'CZ',
    };

    const result = await reserveMerchandise(
      'order-1',
      [{ variantId: 'variant-1', quantity: 1, shippingAddress }],
      '550e8400-e29b-41d4-a716-446655440000',
      deps,
    );

    expect(result[0].fulfillment).toBe('shipping');
    expect(deps.mockKafka.send).toHaveBeenCalledWith('merchandise.reserved', expect.any(Object));
  });

  it('throws SHIPPING_REQUIRED when shipping fulfillment has no address', async () => {
    const variant = makeVariant({ fulfillment: 'shipping' });

    const deps = makeDeps({
      queryResults: [[], [variant]],
    });

    await expect(
      reserveMerchandise(
        'order-1',
        [{ variantId: 'variant-1', quantity: 1 }], // no shippingAddress
        '550e8400-e29b-41d4-a716-446655440001',
        deps,
      ),
    ).rejects.toMatchObject({ code: 'SHIPPING_REQUIRED', statusCode: 422 });
  });

  it('throws VARIANT_NOT_FOUND when variant does not exist', async () => {
    const deps = makeDeps({
      queryResults: [[], []], // idempotency → empty, then variant → empty
    });

    await expect(
      reserveMerchandise(
        'order-1',
        [{ variantId: 'nonexistent-variant', quantity: 1 }],
        '550e8400-e29b-41d4-a716-446655440002',
        deps,
      ),
    ).rejects.toMatchObject({ code: 'VARIANT_NOT_FOUND', statusCode: 404 });
  });

  it('throws VARIANT_SOLD_OUT when available is 0', async () => {
    const variant = makeVariant({ total_qty: 10, sold_count: 5, reserved_count: 5 }); // 0 available

    const deps = makeDeps({
      queryResults: [[], [variant]],
    });

    await expect(
      reserveMerchandise(
        'order-1',
        [{ variantId: 'variant-1', quantity: 1 }],
        '550e8400-e29b-41d4-a716-446655440003',
        deps,
      ),
    ).rejects.toMatchObject({ code: 'VARIANT_SOLD_OUT', statusCode: 409 });
  });

  it('throws INSUFFICIENT_STOCK when requested quantity exceeds available', async () => {
    const variant = makeVariant({ total_qty: 10, sold_count: 0, reserved_count: 8 }); // 2 available

    const deps = makeDeps({
      queryResults: [[], [variant]],
    });

    await expect(
      reserveMerchandise(
        'order-1',
        [{ variantId: 'variant-1', quantity: 5 }], // 5 > 2 available
        '550e8400-e29b-41d4-a716-446655440004',
        deps,
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK', statusCode: 409 });
  });

  it('throws DUPLICATE_ORDER on second request with same idempotency key', async () => {
    const existingItem = makeOrderItem();

    const deps = makeDeps({
      queryResults: [[existingItem]], // idempotency check returns existing item
    });

    await expect(
      reserveMerchandise(
        'order-1',
        [{ variantId: 'variant-1', quantity: 1 }],
        '550e8400-e29b-41d4-a716-446655440000', // same key
        deps,
      ),
    ).rejects.toMatchObject({ code: 'DUPLICATE_ORDER', statusCode: 409 });
  });

  it('emits merchandise.reserved Kafka event after successful reservation', async () => {
    const variant = makeVariant();
    const orderItem = makeOrderItem();

    const kafkaSend = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      queryResults: [[], [variant], [orderItem], [{ ...variant, reserved_count: 1 }]],
      kafkaSend,
    });

    await reserveMerchandise(
      'order-1',
      [{ variantId: 'variant-1', quantity: 1 }],
      '550e8400-e29b-41d4-a716-446655440000',
      deps,
    );

    expect(kafkaSend).toHaveBeenCalledWith(
      'merchandise.reserved',
      expect.objectContaining({
        eventType: 'merchandise.reserved',
        orderId: 'order-1',
        items: expect.arrayContaining([
          expect.objectContaining({ variantId: 'variant-1' }),
        ]),
        timestamp: expect.any(String),
      }),
    );
  });

  it('emits merchandise.inventory.low when available <= low_threshold after reservation', async () => {
    const variant = makeVariant({ total_qty: 5, sold_count: 0, reserved_count: 1 }); // 4 available before
    const orderItem = makeOrderItem({ quantity: 2 });
    // After reservation: reserved_count = 3, available = 2 <= low_threshold (3)
    const afterReservation = makeVariant({ total_qty: 5, sold_count: 0, reserved_count: 3 });

    const kafkaSend = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      queryResults: [[], [variant], [orderItem], [afterReservation]],
      kafkaSend,
    });

    await reserveMerchandise(
      'order-1',
      [{ variantId: 'variant-1', quantity: 2 }],
      '550e8400-e29b-41d4-a716-446655440000',
      deps,
    );

    expect(kafkaSend).toHaveBeenCalledWith(
      'merchandise.inventory.low',
      expect.objectContaining({
        eventType: 'merchandise.inventory.low',
        variantId: 'variant-1',
        available: 2,
      }),
    );
  });

  it('allows reservation when total_qty is null (unlimited)', async () => {
    const variant = makeVariant({ total_qty: null, sold_count: 0, reserved_count: 0 });
    const orderItem = makeOrderItem({ quantity: 10 });

    const deps = makeDeps({
      queryResults: [[], [variant], [orderItem], [{ ...variant }]],
    });

    const result = await reserveMerchandise(
      'order-1',
      [{ variantId: 'variant-1', quantity: 10 }],
      '550e8400-e29b-41d4-a716-446655440000',
      deps,
    );

    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(10); // unlimited — all 10 reserved
  });

  it('calculates unit_price as base_price + price_modifier', async () => {
    const variant = makeVariant({ base_price: 59900, price_modifier: 10000 }); // 59900 + 10000 = 69900
    const orderItem = makeOrderItem({ unit_price: 69900, total_price: 69900 });

    const deps = makeDeps({
      queryResults: [[], [variant], [orderItem], [variant]],
    });

    const result = await reserveMerchandise(
      'order-1',
      [{ variantId: 'variant-1', quantity: 1 }],
      '550e8400-e29b-41d4-a716-446655440000',
      deps,
    );

    // Verify INSERT was called with correct price (69900)
    expect((deps.db.query as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO merchandise.order_items'),
      expect.arrayContaining([69900, 69900]),
    );
  });

  it('race condition: concurrent reservation of last unit — second fails', async () => {
    // Simulate two concurrent requests both seeing 1 unit available,
    // but the second one runs after reserved_count has been updated
    const variant = makeVariant({ total_qty: 1, sold_count: 0, reserved_count: 0 });
    const orderItem = makeOrderItem();

    let requestCount = 0;

    // Request 1: sees 1 available, succeeds
    const deps1 = makeDeps({
      queryResults: [[], [variant], [orderItem], [{ ...variant, reserved_count: 1 }]],
    });

    // Request 2: variant now fully reserved after request 1
    const variantReserved = makeVariant({ total_qty: 1, sold_count: 0, reserved_count: 1 });
    const deps2 = makeDeps({
      queryResults: [[], [variantReserved]],
    });

    const result1 = await reserveMerchandise(
      'order-1',
      [{ variantId: 'variant-1', quantity: 1 }],
      '550e8400-e29b-41d4-a716-446655440010',
      deps1,
    );

    await expect(
      reserveMerchandise(
        'order-2',
        [{ variantId: 'variant-1', quantity: 1 }],
        '550e8400-e29b-41d4-a716-446655440011',
        deps2,
      ),
    ).rejects.toMatchObject({ code: 'VARIANT_SOLD_OUT', statusCode: 409 });

    expect(result1).toHaveLength(1);
  });
});

describe('cancelMerchandiseItem', () => {
  it('cancels pending item and decrements reserved_count', async () => {
    const item = makeOrderItem({ status: 'pending', order_id: 'order-1' });

    const executeImpl = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      queryResults: [[item]],
      executeImpl,
    });

    await cancelMerchandiseItem('order-1', 'item-1', 'user-1', deps);

    // Should have called execute twice: decrement reserved_count + update status
    expect(executeImpl).toHaveBeenCalledTimes(2);
    expect(executeImpl).toHaveBeenCalledWith(
      expect.stringContaining('reserved_count = reserved_count - $1'),
      [1, 'variant-1'],
    );
    expect(executeImpl).toHaveBeenCalledWith(
      expect.stringContaining("status = 'cancelled'"),
      ['item-1'],
    );
  });

  it('throws CANCEL_NOT_ALLOWED when item status is paid', async () => {
    const item = makeOrderItem({ status: 'paid', order_id: 'order-1' });

    const deps = makeDeps({
      queryResults: [[item]],
    });

    await expect(
      cancelMerchandiseItem('order-1', 'item-1', 'user-1', deps),
    ).rejects.toMatchObject({ code: 'CANCEL_NOT_ALLOWED', statusCode: 422 });
  });

  it('throws ORDER_ITEM_NOT_FOUND when item does not exist', async () => {
    const deps = makeDeps({
      queryResults: [[]], // empty result
    });

    await expect(
      cancelMerchandiseItem('order-1', 'nonexistent-item', 'user-1', deps),
    ).rejects.toMatchObject({ code: 'ORDER_ITEM_NOT_FOUND', statusCode: 404 });
  });

  it('throws ORDER_ITEM_NOT_FOUND when orderId does not match (anti-enumeration)', async () => {
    const item = makeOrderItem({ status: 'pending', order_id: 'other-order' });

    const deps = makeDeps({
      queryResults: [[item]],
    });

    await expect(
      cancelMerchandiseItem('order-1', 'item-1', 'user-1', deps),
    ).rejects.toMatchObject({ code: 'ORDER_ITEM_NOT_FOUND', statusCode: 404 });
  });
});

describe('createProduct', () => {
  it('creates product with 2 variants in a transaction', async () => {
    const product = makeProduct();
    const variant1 = makeVariant({ id: 'var-1', sku: 'SKU-1', name: 'S / Černá' });
    const variant2 = makeVariant({ id: 'var-2', sku: 'SKU-2', name: 'M / Bílá', price_modifier: 5000 });

    let txQueryCount = 0;
    const txQueryResults = [product, variant1, variant2];

    const txDb: DbAdapter = {
      query: vi.fn().mockImplementation(() => {
        const r = txQueryResults[txQueryCount];
        txQueryCount++;
        return Promise.resolve([r]);
      }),
      execute: vi.fn().mockResolvedValue(undefined),
      transaction: vi.fn(),
    };

    const deps = makeDeps({
      transactionImpl: (fn) => fn(txDb),
    });

    const result = await createProduct(
      'event-1',
      'org-1',
      {
        name: 'Test T-shirt',
        basePrice: 59900,
        currency: 'CZK',
        fulfillment: 'pickup_at_venue',
        variants: [
          { sku: 'SKU-1', name: 'S / Černá' },
          { sku: 'SKU-2', name: 'M / Bílá', priceModifier: 5000 },
        ],
      },
      deps,
    );

    expect(result.id).toBe('prod-1');
    expect(result.organizerId).toBe('org-1');
    expect(result.variants).toHaveLength(2);
  });

  it('variant with priceModifier has correct computed price', async () => {
    const product = makeProduct({ base_price: 59900 });
    const variant = makeVariant({
      id: 'var-2',
      sku: 'SKU-XL',
      name: 'XL / Černá',
      price_modifier: 10000,
      base_price: 59900,
    });

    let txQueryCount = 0;
    const txDb: DbAdapter = {
      query: vi.fn().mockImplementation(() => {
        const results = [[product], [variant]];
        const r = results[txQueryCount] ?? [];
        txQueryCount++;
        return Promise.resolve(r);
      }),
      execute: vi.fn().mockResolvedValue(undefined),
      transaction: vi.fn(),
    };

    const deps = makeDeps({
      transactionImpl: (fn) => fn(txDb),
    });

    const result = await createProduct(
      'event-1',
      'org-1',
      {
        name: 'Test Mikina',
        basePrice: 59900,
        fulfillment: 'pickup_at_venue',
        variants: [{ sku: 'SKU-XL', name: 'XL / Černá', priceModifier: 10000 }],
      },
      deps,
    );

    // price = base_price (59900) + price_modifier (10000) = 69900
    expect(result.variants[0].price).toBe(69900);
  });
});

describe('archiveProduct', () => {
  it('sets product status to archived (soft delete)', async () => {
    const product = makeProduct({ organizer_id: 'org-1' });
    const executeImpl = vi.fn().mockResolvedValue(undefined);

    const deps = makeDeps({
      queryResults: [[product]],
      executeImpl,
    });

    await archiveProduct('prod-1', 'org-1', deps);

    expect(executeImpl).toHaveBeenCalledWith(
      expect.stringContaining("status = 'archived'"),
      ['prod-1'],
    );
  });

  it('throws UNAUTHORIZED for wrong organizerId (anti-enumeration)', async () => {
    const product = makeProduct({ organizer_id: 'org-1' });

    const deps = makeDeps({
      queryResults: [[product]],
    });

    await expect(
      archiveProduct('prod-1', 'different-org', deps),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED', statusCode: 404 });
  });
});

describe('getInventory', () => {
  it('returns correct inventory counts per variant', async () => {
    const product = makeProduct({ organizer_id: 'org-1' });
    const variants = [
      makeVariant({ id: 'var-1', sku: 'SKU-S', total_qty: 50, sold_count: 20, reserved_count: 5 }),
      makeVariant({ id: 'var-2', sku: 'SKU-L', total_qty: 30, sold_count: 28, reserved_count: 2, low_threshold: 3 }),
    ];

    const deps = makeDeps({
      queryResults: [[product], variants],
    });

    const result = await getInventory('prod-1', 'org-1', deps);

    expect(result.productId).toBe('prod-1');
    expect(result.variants).toHaveLength(2);

    const skuS = result.variants.find((v) => v.sku === 'SKU-S')!;
    expect(skuS.soldCount).toBe(20);
    expect(skuS.reservedCount).toBe(5);
    expect(skuS.available).toBe(25);
    expect(skuS.isLowStock).toBe(false);

    const skuL = result.variants.find((v) => v.sku === 'SKU-L')!;
    expect(skuL.soldCount).toBe(28);
    expect(skuL.reservedCount).toBe(2);
    expect(skuL.available).toBe(0);
    expect(skuL.isLowStock).toBe(true);
  });

  it('throws UNAUTHORIZED when product belongs to different organizer', async () => {
    const product = makeProduct({ organizer_id: 'org-1' });

    const deps = makeDeps({
      queryResults: [[product]],
    });

    await expect(
      getInventory('prod-1', 'wrong-org', deps),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED', statusCode: 404 });
  });
});

describe('getProductsForEvent', () => {
  it('returns only active products with available variants', async () => {
    const products = [makeProduct({ status: 'active' })];
    const variants = [
      makeVariant({ id: 'var-1', total_qty: 10, sold_count: 3, reserved_count: 2 }), // 5 available
    ];

    const deps = makeDeps({
      queryResults: [products, variants],
    });

    const result = await getProductsForEvent('event-1', undefined, deps);

    expect(result).toHaveLength(1);
    expect(result[0].variants).toHaveLength(1);
    expect(result[0].variants[0].remainingQty).toBe(5);
    expect(result[0].variants[0].isAvailable).toBe(true);
  });

  it('filters out fully sold-out variants', async () => {
    const products = [makeProduct({ status: 'active' })];
    const variants = [
      makeVariant({ id: 'var-1', total_qty: 5, sold_count: 3, reserved_count: 2 }), // 0 available → filtered
      makeVariant({ id: 'var-2', sku: 'SKU-2', total_qty: 10, sold_count: 2, reserved_count: 0 }), // 8 available
    ];

    const deps = makeDeps({
      queryResults: [products, variants],
    });

    const result = await getProductsForEvent('event-1', undefined, deps);

    expect(result[0].variants).toHaveLength(1);
    expect(result[0].variants[0].id).toBe('var-2');
  });
});
