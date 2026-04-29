import { describe, it, expect, vi } from 'vitest';
import { detectPatterns } from '../lib/pattern-recognition.js';
import type { ServiceDeps } from '../lib/service-container.js';

/**
 * detectPatterns issues several queries in parallel; our mock returns a
 * canned response keyed by the leading SQL fragment. This keeps tests
 * decoupled from call order.
 */
function mockDepsBySql(responses: Array<{ match: RegExp; rows: unknown[] }>): ServiceDeps {
  const query = vi.fn(async (sql: string) => {
    for (const r of responses) {
      if (r.match.test(sql)) return r.rows;
    }
    return [];
  });
  return {
    db: { query: query as ServiceDeps['db']['query'], execute: vi.fn() },
    kafka: { send: vi.fn() },
  };
}

describe('detectPatterns', () => {
  it('matches card_testing with 3 small charges', async () => {
    const deps = mockDepsBySql([
      {
        match: /payments\.payments p[\s\S]*amount_hellers < 5000/,
        rows: [{ card_fingerprint: 'abcdef0123456789', cnt: 3, payment_ids: ['p1', 'p2', 'p3'] }],
      },
    ]);
    const results = await detectPatterns('user', 'u1', deps);
    expect(results.some((r) => r.pattern === 'card_testing')).toBe(true);
  });

  it('matches first_purchase_high_value for 30-min-old account with 10000 Kč order', async () => {
    const deps = mockDepsBySql([
      {
        match: /account_age_minutes/,
        rows: [
          {
            user_id: 'u1',
            account_age_minutes: '30',
            total_hellers: 1_000_000, // 10 000 Kč in hellers
            order_id: 'o1',
          },
        ],
      },
    ]);
    const results = await detectPatterns('user', 'u1', deps);
    expect(results.some((r) => r.pattern === 'first_purchase_high_value')).toBe(true);
  });

  it('matches bulk_resale_prep with 5 orders for same event', async () => {
    const deps = mockDepsBySql([
      {
        match: /FROM orders\.orders[\s\S]*GROUP BY event_id/,
        rows: [{ event_id: 'e1', cnt: 5, order_ids: ['o1', 'o2', 'o3', 'o4', 'o5'] }],
      },
    ]);
    const results = await detectPatterns('user', 'u1', deps);
    expect(results.some((r) => r.pattern === 'bulk_resale_prep')).toBe(true);
  });

  it('returns empty for quiet user', async () => {
    const deps = mockDepsBySql([]);
    const results = await detectPatterns('user', 'u1', deps);
    expect(results).toEqual([]);
  });
});
