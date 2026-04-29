/**
 * Contract testy pro bulk-refund logiku — bez DB závislosti.
 *
 * Verifikujeme, že outcome shape obsahuje wrong_promoter status pro
 * cross-tenant pokus.
 */

import { describe, it, expect } from 'vitest';

type Outcome =
  | { orderId: string; status: 'refunded'; amountHalire: number }
  | { orderId: string; status: 'already_refunded'; amountHalire: number }
  | { orderId: string; status: 'wrong_promoter' }
  | { orderId: string; status: 'not_found' }
  | { orderId: string; status: 'error'; reason: string };

describe('bulk-refund outcome shape', () => {
  it('refunded result contains amount', () => {
    const r: Outcome = { orderId: 'o-1', status: 'refunded', amountHalire: 5000 };
    if (r.status === 'refunded') {
      expect(r.amountHalire).toBe(5000);
    }
  });

  it('wrong_promoter does NOT leak amount (privacy)', () => {
    const r: Outcome = { orderId: 'o-1', status: 'wrong_promoter' };
    expect(r).not.toHaveProperty('amountHalire');
  });

  it('summary reduce skips errors and not_found', () => {
    const outcomes: Outcome[] = [
      { orderId: 'o-1', status: 'refunded', amountHalire: 5000 },
      { orderId: 'o-2', status: 'wrong_promoter' },
      { orderId: 'o-3', status: 'refunded', amountHalire: 3000 },
      { orderId: 'o-4', status: 'not_found' },
      { orderId: 'o-5', status: 'already_refunded', amountHalire: 1000 },
    ];
    const refunded = outcomes.filter((o) => o.status === 'refunded');
    const total = refunded.reduce(
      (s, o) => s + (o.status === 'refunded' ? o.amountHalire : 0),
      0,
    );
    expect(refunded).toHaveLength(2);
    expect(total).toBe(8000);
    expect(outcomes.filter((o) => o.status === 'wrong_promoter')).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === 'not_found')).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === 'already_refunded')).toHaveLength(1);
  });
});
