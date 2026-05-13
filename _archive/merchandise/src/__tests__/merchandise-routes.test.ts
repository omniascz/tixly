import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET as getEventMerchandise } from '../app/api/events/[eventId]/merchandise/route';
import { POST as postOrderMerchandise } from '../app/api/orders/[orderId]/merchandise/route';
import { DELETE as deleteOrderItem } from '../app/api/orders/[orderId]/merchandise/[orderItemId]/route';
import { GET as getOrganizerMerchandise, POST as postOrganizerMerchandise } from '../app/api/organizer/events/[eventId]/merchandise/route';
import { PUT as putOrganizerProduct, DELETE as deleteOrganizerProduct } from '../app/api/organizer/events/[eventId]/merchandise/[productId]/route';
import { GET as getInventory } from '../app/api/organizer/events/[eventId]/merchandise/[productId]/inventory/route';
import { NextRequest } from './__mocks__/next-server';
import type { ServiceDeps } from '../lib/service-container';
import type { ProductPublic, ProductOrganizer, OrderItemRow, InventoryReport } from '../types/merchandise';

// ─── Minimal NextRequest factory ──────────────────────────────────────────────

function makeRequest(opts: {
  url?: string;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  searchParams?: Record<string, string>;
}): NextRequest {
  const url = opts.url ?? 'http://localhost:3000/api/test';
  const fullUrl = opts.searchParams
    ? `${url}?${new URLSearchParams(opts.searchParams).toString()}`
    : url;

  const headerEntries = opts.headers ?? {};
  const headersInit: Record<string, string> = { ...headerEntries };

  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers: headersInit,
  };

  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    headersInit['content-type'] = 'application/json';
  }

  return new NextRequest(fullUrl, init);
}

// ─── Mock product data ────────────────────────────────────────────────────────

function makePublicProduct(overrides: Partial<ProductPublic> = {}): ProductPublic {
  return {
    id: 'prod-1',
    eventId: 'event-1',
    name: 'Test T-shirt',
    description: null,
    basePrice: 59900,
    currency: 'CZK',
    fulfillment: 'pickup_at_venue',
    imageUrls: [],
    variants: [
      {
        id: 'var-1',
        sku: 'SKU-M',
        name: 'M / Černá',
        price: 59900,
        currency: 'CZK',
        remainingQty: 50,
        isLowStock: false,
        isAvailable: true,
        attributes: { size: 'M', color: 'black' },
      },
    ],
    ...overrides,
  };
}

function makeOrganizerProduct(overrides: Partial<ProductOrganizer> = {}): ProductOrganizer {
  return {
    ...makePublicProduct(),
    organizerId: 'org-1',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeOrderItem(overrides: Partial<OrderItemRow> = {}): OrderItemRow {
  return {
    id: 'item-1',
    order_id: 'order-1',
    product_id: 'prod-1',
    variant_id: 'var-1',
    quantity: 2,
    unit_price: 59900,
    total_price: 119800,
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

// ─── Mock deps ────────────────────────────────────────────────────────────────

function makeDeps(serviceOverrides: Partial<ServiceDeps> = {}): ServiceDeps {
  return {
    db: {
      query: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
      transaction: vi.fn().mockImplementation((fn) =>
        fn({
          query: vi.fn().mockResolvedValue([]),
          execute: vi.fn().mockResolvedValue(undefined),
          transaction: vi.fn(),
        }),
      ),
    },
    kafka: {
      send: vi.fn().mockResolvedValue(undefined),
    },
    ...serviceOverrides,
  };
}

// ─── GET /api/events/[eventId]/merchandise ────────────────────────────────────

describe('GET /api/events/[eventId]/merchandise', () => {
  it('returns 200 with active products only', async () => {
    const product = makePublicProduct();
    const deps = makeDeps({
      db: {
        query: vi.fn()
          .mockResolvedValueOnce([{
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
          }])
          .mockResolvedValueOnce([{
            id: 'var-1',
            product_id: 'prod-1',
            sku: 'SKU-M',
            name: 'M / Černá',
            price_modifier: 0,
            total_qty: 100,
            sold_count: 10,
            reserved_count: 5,
            low_threshold: 3,
            attributes: {},
            is_active: true,
            created_at: new Date().toISOString(),
          }]),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      },
      kafka: { send: vi.fn() },
    });

    const req = makeRequest({ url: 'http://localhost/api/events/event-1/merchandise' });
    const res = await getEventMerchandise(
      req as any,
      { params: { eventId: 'event-1' } },
      deps,
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].id).toBe('prod-1');
  });

  it('filters variants without stock (sold out)', async () => {
    const deps = makeDeps({
      db: {
        query: vi.fn()
          .mockResolvedValueOnce([{
            id: 'prod-1',
            event_id: 'event-1',
            organizer_id: 'org-1',
            name: 'Sold-out Shirt',
            description: null,
            base_price: 59900,
            currency: 'CZK',
            fulfillment: 'pickup_at_venue',
            image_urls: [],
            metadata: {},
            status: 'active',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }])
          .mockResolvedValueOnce([{
            id: 'var-1',
            product_id: 'prod-1',
            sku: 'SKU-M',
            name: 'M',
            price_modifier: 0,
            total_qty: 10,
            sold_count: 6,
            reserved_count: 4,  // 6+4 = 10 = total_qty → sold out
            low_threshold: 3,
            attributes: {},
            is_active: true,
            created_at: new Date().toISOString(),
          }]),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      },
      kafka: { send: vi.fn() },
    });

    const req = makeRequest({ url: 'http://localhost/api/events/event-1/merchandise' });
    const res = await getEventMerchandise(
      req as any,
      { params: { eventId: 'event-1' } },
      deps,
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    // Product exists but variants are empty (sold out variant filtered)
    expect(data[0].variants).toHaveLength(0);
  });
});

// ─── POST /api/orders/[orderId]/merchandise ───────────────────────────────────

describe('POST /api/orders/[orderId]/merchandise', () => {
  it('returns 201 with created order items on success', async () => {
    const orderItem = makeOrderItem();
    const deps = makeDeps({
      db: {
        query: vi.fn()
          // idempotency check
          .mockResolvedValueOnce([])
          // variant FOR UPDATE
          .mockResolvedValueOnce([{
            id: 'var-1',
            product_id: 'prod-1',
            sku: 'SKU-M',
            name: 'M',
            price_modifier: 0,
            total_qty: 100,
            sold_count: 0,
            reserved_count: 0,
            low_threshold: 3,
            attributes: {},
            is_active: true,
            created_at: new Date().toISOString(),
            base_price: 59900,
            fulfillment: 'pickup_at_venue',
            currency: 'CZK',
          }])
          // INSERT returning
          .mockResolvedValueOnce([orderItem])
          // post-reservation low-stock check
          .mockResolvedValueOnce([{
            id: 'var-1', product_id: 'prod-1', total_qty: 100,
            sold_count: 0, reserved_count: 1, low_threshold: 3,
          }]),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn().mockImplementation((fn) => {
          const txDb = {
            query: vi.fn()
              .mockResolvedValueOnce([{
                id: 'var-1',
                product_id: 'prod-1',
                sku: 'SKU-M',
                name: 'M',
                price_modifier: 0,
                total_qty: 100,
                sold_count: 0,
                reserved_count: 0,
                low_threshold: 3,
                attributes: {},
                is_active: true,
                created_at: new Date().toISOString(),
                base_price: 59900,
                fulfillment: 'pickup_at_venue',
                currency: 'CZK',
              }])
              .mockResolvedValueOnce([orderItem]),
            execute: vi.fn().mockResolvedValue(undefined),
            transaction: vi.fn(),
          };
          return fn(txDb);
        }),
      },
      kafka: { send: vi.fn().mockResolvedValue(undefined) },
    });

    const req = makeRequest({
      url: 'http://localhost/api/orders/order-1/merchandise',
      method: 'POST',
      body: {
        items: [{ variantId: '550e8400-e29b-41d4-a716-000000000001', quantity: 2 }],
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
      },
    });

    const res = await postOrderMerchandise(
      req as any,
      { params: { orderId: 'order-1' } },
      deps,
    );

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('returns 400 when idempotencyKey is missing', async () => {
    const deps = makeDeps();

    const req = makeRequest({
      url: 'http://localhost/api/orders/order-1/merchandise',
      method: 'POST',
      body: {
        items: [{ variantId: 'var-1', quantity: 1 }],
        // no idempotencyKey
      },
    });

    const res = await postOrderMerchandise(
      req as any,
      { params: { orderId: 'order-1' } },
      deps,
    );

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Validation failed');
  });

  it('returns 400 when body is not valid JSON', async () => {
    const deps = makeDeps();

    const req = new NextRequest('http://localhost/api/orders/order-1/merchandise', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });

    const res = await postOrderMerchandise(
      req as any,
      { params: { orderId: 'order-1' } },
      deps,
    );

    expect(res.status).toBe(400);
  });
});

// ─── DELETE /api/orders/[orderId]/merchandise/[orderItemId] ───────────────────

describe('DELETE /api/orders/[orderId]/merchandise/[orderItemId]', () => {
  it('returns 204 when deleting pending item', async () => {
    const item = makeOrderItem({ status: 'pending', order_id: 'order-1' });
    const deps = makeDeps({
      db: {
        query: vi.fn().mockResolvedValueOnce([item]),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn().mockImplementation((fn) => {
          const txDb = {
            query: vi.fn(),
            execute: vi.fn().mockResolvedValue(undefined),
            transaction: vi.fn(),
          };
          return fn(txDb);
        }),
      },
      kafka: { send: vi.fn() },
    });

    const req = makeRequest({
      url: 'http://localhost/api/orders/order-1/merchandise/item-1',
      method: 'DELETE',
      headers: { 'x-user-id': 'user-1' },
    });

    const res = await deleteOrderItem(
      req as any,
      { params: { orderId: 'order-1', orderItemId: 'item-1' } },
      deps,
    );

    expect(res.status).toBe(204);
  });

  it('returns 422 when trying to cancel a paid item', async () => {
    const item = makeOrderItem({ status: 'paid', order_id: 'order-1' });
    const deps = makeDeps({
      db: {
        query: vi.fn().mockResolvedValueOnce([item]),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      },
      kafka: { send: vi.fn() },
    });

    const req = makeRequest({
      url: 'http://localhost/api/orders/order-1/merchandise/item-1',
      method: 'DELETE',
      headers: { 'x-user-id': 'user-1' },
    });

    const res = await deleteOrderItem(
      req as any,
      { params: { orderId: 'order-1', orderItemId: 'item-1' } },
      deps,
    );

    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.code).toBe('CANCEL_NOT_ALLOWED');
  });
});

// ─── Organizer routes ─────────────────────────────────────────────────────────

describe('Organizer POST /api/organizer/events/[eventId]/merchandise', () => {
  it('returns 201 with created product', async () => {
    const product = makeOrganizerProduct();
    const deps = makeDeps({
      db: {
        query: vi.fn(),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn().mockImplementation((fn) => {
          const txDb = {
            query: vi.fn()
              .mockResolvedValueOnce([{
                id: 'prod-1',
                event_id: 'event-1',
                organizer_id: 'org-1',
                name: 'New Product',
                description: null,
                base_price: 59900,
                currency: 'CZK',
                fulfillment: 'pickup_at_venue',
                image_urls: [],
                metadata: {},
                status: 'active',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              }])
              .mockResolvedValueOnce([{
                id: 'var-1',
                product_id: 'prod-1',
                sku: 'SKU-M',
                name: 'M',
                price_modifier: 0,
                total_qty: null,
                sold_count: 0,
                reserved_count: 0,
                low_threshold: 3,
                attributes: {},
                is_active: true,
                created_at: new Date().toISOString(),
              }]),
            execute: vi.fn().mockResolvedValue(undefined),
            transaction: vi.fn(),
          };
          return fn(txDb);
        }),
      },
      kafka: { send: vi.fn() },
    });

    const req = makeRequest({
      url: 'http://localhost/api/organizer/events/event-1/merchandise',
      method: 'POST',
      headers: { 'x-organizer-id': 'org-1' },
      body: {
        name: 'New Product',
        basePrice: 59900,
        fulfillment: 'pickup_at_venue',
        variants: [{ sku: 'SKU-M', name: 'M' }],
      },
    });

    const res = await postOrganizerMerchandise(
      req as any,
      { params: { eventId: 'event-1' } },
      deps,
    );

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBe('prod-1');
  });
});

describe('Organizer PUT /api/organizer/events/[eventId]/merchandise/[productId]', () => {
  it('returns 200 with updated product', async () => {
    const existingProduct = {
      id: 'prod-1',
      event_id: 'event-1',
      organizer_id: 'org-1',
      name: 'Old Name',
      description: null,
      base_price: 59900,
      currency: 'CZK',
      fulfillment: 'pickup_at_venue',
      image_urls: [],
      metadata: {},
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const updatedProduct = { ...existingProduct, name: 'New Name' };

    const deps = makeDeps({
      db: {
        query: vi.fn(),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn().mockImplementation((fn) => {
          const txDb = {
            query: vi.fn()
              .mockResolvedValueOnce([existingProduct])   // SELECT FOR UPDATE
              .mockResolvedValueOnce([updatedProduct])    // UPDATE RETURNING
              .mockResolvedValueOnce([{                   // fetch variants
                id: 'var-1',
                product_id: 'prod-1',
                sku: 'SKU-M',
                name: 'M',
                price_modifier: 0,
                total_qty: null,
                sold_count: 0,
                reserved_count: 0,
                low_threshold: 3,
                attributes: {},
                is_active: true,
                created_at: new Date().toISOString(),
              }]),
            execute: vi.fn().mockResolvedValue(undefined),
            transaction: vi.fn(),
          };
          return fn(txDb);
        }),
      },
      kafka: { send: vi.fn() },
    });

    const req = makeRequest({
      url: 'http://localhost/api/organizer/events/event-1/merchandise/prod-1',
      method: 'PUT',
      headers: { 'x-organizer-id': 'org-1' },
      body: { name: 'New Name' },
    });

    const res = await putOrganizerProduct(
      req as any,
      { params: { eventId: 'event-1', productId: 'prod-1' } },
      deps,
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe('New Name');
  });
});

describe('Organizer DELETE /api/organizer/events/[eventId]/merchandise/[productId]', () => {
  it('returns 204 on soft delete (archive)', async () => {
    const product = {
      id: 'prod-1',
      organizer_id: 'org-1',
    };

    const executeImpl = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      db: {
        query: vi.fn().mockResolvedValueOnce([product]),
        execute: executeImpl,
        transaction: vi.fn(),
      },
      kafka: { send: vi.fn() },
    });

    const req = makeRequest({
      url: 'http://localhost/api/organizer/events/event-1/merchandise/prod-1',
      method: 'DELETE',
      headers: { 'x-organizer-id': 'org-1' },
    });

    const res = await deleteOrganizerProduct(
      req as any,
      { params: { eventId: 'event-1', productId: 'prod-1' } },
      deps,
    );

    expect(res.status).toBe(204);
    expect(executeImpl).toHaveBeenCalledWith(
      expect.stringContaining("status = 'archived'"),
      ['prod-1'],
    );
  });
});

describe('Organizer GET /api/organizer/events/[eventId]/merchandise/[productId]/inventory', () => {
  it('returns 200 with correct inventory data', async () => {
    const product = {
      id: 'prod-1',
      organizer_id: 'org-1',
    };
    const variants = [
      {
        id: 'var-1',
        product_id: 'prod-1',
        sku: 'SKU-M',
        name: 'M',
        total_qty: 100,
        sold_count: 30,
        reserved_count: 10,
        low_threshold: 5,
      },
    ];

    const deps = makeDeps({
      db: {
        query: vi.fn()
          .mockResolvedValueOnce([product])
          .mockResolvedValueOnce(variants),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      },
      kafka: { send: vi.fn() },
    });

    const req = makeRequest({
      url: 'http://localhost/api/organizer/events/event-1/merchandise/prod-1/inventory',
      headers: { 'x-organizer-id': 'org-1' },
    });

    const res = await getInventory(
      req as any,
      { params: { eventId: 'event-1', productId: 'prod-1' } },
      deps,
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.productId).toBe('prod-1');
    expect(data.variants[0].soldCount).toBe(30);
    expect(data.variants[0].reservedCount).toBe(10);
    expect(data.variants[0].available).toBe(60);
    expect(data.variants[0].isLowStock).toBe(false);
  });
});
