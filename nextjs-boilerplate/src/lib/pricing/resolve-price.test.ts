import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveCurrentPrice,
  PriceMismatchError,
  PriceResolutionError,
  _resetTableExistsCacheForTests,
} from './resolve-price';

beforeEach(() => {
  _resetTableExistsCacheForTests();
});

interface FakeDb {
  // Test stub — pg-compatible query signature, ale s relaxovaným return
  // typem (vitest mock vrací různé shapy podle SQL).
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}

function makeDb(handlers: {
  ticketType?: { event_id: string; base_price: number; remaining_qty: number } | null;
  tier?: { id: string; total_hellers: number } | null;
  rules?: Array<{
    id: string;
    price: number;
    threshold_qty: number | null;
    threshold_date: string | null;
  }>;
}): FakeDb {
  const calls: Array<{ text: string }> = [];
  return {
    async query(text: string) {
      calls.push({ text });
      if (text.includes('information_schema.tables')) {
        return { rows: [{ exists: true }] };
      }
      if (text.includes('FROM catalog.ticket_types')) {
        if (!handlers.ticketType) return { rows: [] };
        return {
          rows: [
            {
              id: 'tt-1',
              event_id: handlers.ticketType.event_id,
              base_price: handlers.ticketType.base_price,
              remaining_qty: handlers.ticketType.remaining_qty,
            },
          ],
        };
      }
      if (text.includes('FROM pricing.price_tiers')) {
        return { rows: handlers.tier ? [handlers.tier] : [] };
      }
      if (text.includes('FROM catalog.pricing_rules')) {
        return { rows: handlers.rules ?? [] };
      }
      return { rows: [] };
    },
  };
}

describe('resolveCurrentPrice', () => {
  it('returns base_price when no tier and no rules', async () => {
    const db = makeDb({
      ticketType: { event_id: 'e-1', base_price: 50000, remaining_qty: 100 },
      tier: null,
      rules: [],
    });
    const result = await resolveCurrentPrice('tt-1', 'e-1', db as unknown as never);
    expect(result.unitPriceHalire).toBe(50000);
    expect(result.source).toBe('base');
    expect(result.ruleId).toBeNull();
    expect(result.tierId).toBeNull();
  });

  it('uses pricing.price_tiers total when present (overrides everything)', async () => {
    const db = makeDb({
      ticketType: { event_id: 'e-1', base_price: 50000, remaining_qty: 100 },
      tier: { id: 'tier-1', total_hellers: 75000 },
      rules: [{ id: 'r-1', price: 60000, threshold_qty: null, threshold_date: null }],
    });
    const result = await resolveCurrentPrice('tt-1', 'e-1', db as unknown as never);
    expect(result.unitPriceHalire).toBe(75000);
    expect(result.source).toBe('tier');
    expect(result.tierId).toBe('tier-1');
    expect(result.ruleId).toBeNull();
  });

  it('applies active rule with lowest priority (sorted by query)', async () => {
    const db = makeDb({
      ticketType: { event_id: 'e-1', base_price: 50000, remaining_qty: 100 },
      tier: null,
      rules: [
        { id: 'r-priority-0', price: 40000, threshold_qty: null, threshold_date: null },
        { id: 'r-priority-1', price: 45000, threshold_qty: null, threshold_date: null },
      ],
    });
    const result = await resolveCurrentPrice('tt-1', 'e-1', db as unknown as never);
    expect(result.unitPriceHalire).toBe(40000);
    expect(result.source).toBe('rule');
    expect(result.ruleId).toBe('r-priority-0');
  });

  it('skips rule whose threshold_date has not yet arrived', async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const db = makeDb({
      ticketType: { event_id: 'e-1', base_price: 50000, remaining_qty: 100 },
      tier: null,
      rules: [
        { id: 'r-future', price: 30000, threshold_qty: null, threshold_date: future },
        { id: 'r-past', price: 45000, threshold_qty: null, threshold_date: past },
      ],
    });
    const result = await resolveCurrentPrice('tt-1', 'e-1', db as unknown as never);
    expect(result.unitPriceHalire).toBe(45000);
    expect(result.ruleId).toBe('r-past');
  });

  it('skips rule whose threshold_qty is not yet reached', async () => {
    const db = makeDb({
      ticketType: { event_id: 'e-1', base_price: 50000, remaining_qty: 80 },
      tier: null,
      rules: [
        // Rule activates at remaining<=10 (not yet) → skip
        { id: 'r-late', price: 70000, threshold_qty: 10, threshold_date: null },
        // Rule with no threshold → applies
        { id: 'r-default', price: 45000, threshold_qty: null, threshold_date: null },
      ],
    });
    const result = await resolveCurrentPrice('tt-1', 'e-1', db as unknown as never);
    expect(result.unitPriceHalire).toBe(45000);
    expect(result.ruleId).toBe('r-default');
  });

  it('activates threshold_qty rule when remaining_qty drops below threshold', async () => {
    const db = makeDb({
      ticketType: { event_id: 'e-1', base_price: 50000, remaining_qty: 5 },
      tier: null,
      rules: [
        { id: 'r-late', price: 70000, threshold_qty: 10, threshold_date: null },
        { id: 'r-default', price: 45000, threshold_qty: null, threshold_date: null },
      ],
    });
    const result = await resolveCurrentPrice('tt-1', 'e-1', db as unknown as never);
    expect(result.unitPriceHalire).toBe(70000);
    expect(result.ruleId).toBe('r-late');
  });

  it('throws TICKET_TYPE_NOT_FOUND when ticket type does not exist', async () => {
    const db = makeDb({ ticketType: null });
    await expect(resolveCurrentPrice('tt-x', 'e-1', db as unknown as never)).rejects.toThrow(
      PriceResolutionError,
    );
  });

  it('throws PriceMismatchError when expectedHalire does not match server', async () => {
    const db = makeDb({
      ticketType: { event_id: 'e-1', base_price: 50000, remaining_qty: 100 },
      tier: null,
      rules: [],
    });
    await expect(
      resolveCurrentPrice('tt-1', 'e-1', db as unknown as never, { expectedHalire: 99999 }),
    ).rejects.toBeInstanceOf(PriceMismatchError);
  });

  it('falls back to base when pricing.price_tiers table is missing (42P01)', async () => {
    const calls: Array<{ text: string }> = [];
    const db: FakeDb = {
      async query(text: string) {
        calls.push({ text });
        if (text.includes('information_schema.tables')) {
          // pricing.price_tiers does not exist; catalog.pricing_rules does
          if (text.match(/\$1.*\$2/)) {
            // Caller passes [schema, name] — read second positional check for table name
            // We can't easily distinguish without examining params, so toggle by call order
            return {
              rows: [
                {
                  exists: calls.filter((c) => c.text.includes('information_schema'))
                    .length > 1,
                },
              ],
            };
          }
        }
        if (text.includes('FROM catalog.ticket_types')) {
          return {
            rows: [
              { id: 'tt-1', event_id: 'e-1', base_price: 50000, remaining_qty: 100 },
            ],
          };
        }
        if (text.includes('FROM catalog.pricing_rules')) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    };
    const result = await resolveCurrentPrice('tt-1', 'e-1', db as unknown as never);
    expect(result.unitPriceHalire).toBe(50000);
    expect(result.source).toBe('base');
  });

  it('passes when expectedHalire matches server', async () => {
    const db = makeDb({
      ticketType: { event_id: 'e-1', base_price: 50000, remaining_qty: 100 },
      tier: null,
      rules: [],
    });
    const result = await resolveCurrentPrice('tt-1', 'e-1', db as unknown as never, {
      expectedHalire: 50000,
    });
    expect(result.unitPriceHalire).toBe(50000);
  });
});
