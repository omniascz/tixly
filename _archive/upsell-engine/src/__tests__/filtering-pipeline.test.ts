import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAvailableUpsells } from '../lib/filtering-pipeline.js';
import type { DbAdapter } from '../lib/service-container.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    event_id: 'event-1',
    type: 'parking',
    name: 'Parking Pass',
    description: null,
    price: 20000,
    currency: 'CZK',
    platform_fee_pct: 10,
    image_url: null,
    metadata: {},
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    rule_id: 'rule-1',
    ticket_type_id: null,
    timing: 'checkout',
    sort_order: 100,
    max_per_order: null,
    available_from: null,
    available_until: null,
    exclusive_to_ticket_types: [],
    conditions: {},
    is_active: true,
    total_qty: null,
    sold_count: 0,
    reserved_count: 0,
    low_threshold: 5,
    ...overrides,
  };
}

function makeMockDb(rows: unknown[]): DbAdapter {
  return {
    query: vi.fn().mockResolvedValue(rows),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (fn) => fn(makeMockDb(rows))),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('getAvailableUpsells — filtering pipeline', () => {
  it('returns items with status active', async () => {
    const db = makeMockDb([makeRow({ status: 'active' })]);
    const result = await getAvailableUpsells(
      { eventId: 'event-1', timing: 'checkout' },
      { db },
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('item-1');
  });

  it('filters out items where sold_count + reserved_count equals total_qty (sold out)', async () => {
    const db = makeMockDb([makeRow({ total_qty: 10, sold_count: 7, reserved_count: 3 })]);
    const result = await getAvailableUpsells(
      { eventId: 'event-1', timing: 'checkout' },
      { db },
    );
    expect(result).toHaveLength(0);
  });

  it('passes items where sold_count + reserved_count is below total_qty', async () => {
    const db = makeMockDb([makeRow({ total_qty: 10, sold_count: 5, reserved_count: 3 })]);
    const result = await getAvailableUpsells(
      { eventId: 'event-1', timing: 'checkout' },
      { db },
    );
    expect(result).toHaveLength(1);
    expect(result[0].remainingQty).toBe(2);
  });

  it('passes items with total_qty = null (unlimited capacity)', async () => {
    const db = makeMockDb([makeRow({ total_qty: null })]);
    const result = await getAvailableUpsells(
      { eventId: 'event-1', timing: 'checkout' },
      { db },
    );
    expect(result).toHaveLength(1);
    expect(result[0].remainingQty).toBeNull();
  });

  it('shows items to all ticket types when ticket_type_id is null and exclusive_to_ticket_types is empty', async () => {
    const db = makeMockDb([
      makeRow({ ticket_type_id: null, exclusive_to_ticket_types: [] }),
    ]);
    const result = await getAvailableUpsells(
      { eventId: 'event-1', timing: 'checkout', ticketTypeId: 'type-vip' },
      { db },
    );
    expect(result).toHaveLength(1);
  });

  it('filters items exclusive to specific ticket types when ticketTypeId does not match', async () => {
    const db = makeMockDb([
      makeRow({ exclusive_to_ticket_types: ['type-vip'] }),
    ]);
    const result = await getAvailableUpsells(
      { eventId: 'event-1', timing: 'checkout', ticketTypeId: 'type-general' },
      { db },
    );
    expect(result).toHaveLength(0);
  });

  it('passes items exclusive to a ticket type when ticketTypeId matches', async () => {
    const db = makeMockDb([
      makeRow({ exclusive_to_ticket_types: ['type-vip'] }),
    ]);
    const result = await getAvailableUpsells(
      { eventId: 'event-1', timing: 'checkout', ticketTypeId: 'type-vip' },
      { db },
    );
    expect(result).toHaveLength(1);
  });

  it('filters items where ticket_type_id is set and does not match the request', async () => {
    const db = makeMockDb([
      makeRow({ ticket_type_id: 'type-vip', exclusive_to_ticket_types: [] }),
    ]);
    const result = await getAvailableUpsells(
      { eventId: 'event-1', timing: 'checkout', ticketTypeId: 'type-general' },
      { db },
    );
    expect(result).toHaveLength(0);
  });

  it('deduplicates items that appear from multiple rules, keeping lowest sort_order', async () => {
    const db = makeMockDb([
      makeRow({ rule_id: 'rule-1', sort_order: 50 }),
      makeRow({ rule_id: 'rule-2', sort_order: 200 }),
    ]);
    const result = await getAvailableUpsells(
      { eventId: 'event-1', timing: 'checkout' },
      { db },
    );
    expect(result).toHaveLength(1);
  });

  it('sorts items by sort_order ascending', async () => {
    const db = makeMockDb([
      makeRow({ id: 'item-1', sort_order: 200 }),
      makeRow({ id: 'item-2', sort_order: 50 }),
      makeRow({ id: 'item-3', sort_order: 100 }),
    ]);
    const result = await getAvailableUpsells(
      { eventId: 'event-1', timing: 'checkout' },
      { db },
    );
    expect(result.map((r) => r.id)).toEqual(['item-1', 'item-2', 'item-3']);
  });

  it('sets isLowStock = true when remainingQty <= low_threshold', async () => {
    const db = makeMockDb([
      makeRow({ total_qty: 10, sold_count: 6, reserved_count: 0, low_threshold: 5 }),
    ]);
    const result = await getAvailableUpsells(
      { eventId: 'event-1', timing: 'checkout' },
      { db },
    );
    expect(result[0].remainingQty).toBe(4);
    expect(result[0].isLowStock).toBe(true);
  });

  it('returns empty array when no items match', async () => {
    const db = makeMockDb([]);
    const result = await getAvailableUpsells(
      { eventId: 'event-1', timing: 'checkout' },
      { db },
    );
    expect(result).toEqual([]);
  });
});
