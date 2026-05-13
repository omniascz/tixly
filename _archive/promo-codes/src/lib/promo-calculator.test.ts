import { describe, it, expect } from 'vitest';
import {
  validatePromoCodeRules,
  calculateDiscount,
  generatePromoCode,
} from './promo-calculator';
import type { PromoCode, ApplyPromoCodeRequest } from '../types/promo-code.types';
import {
  PromoCodeExpiredError,
  PromoCodeNotYetValidError,
  PromoCodeMaxUsesError,
  PromoCodeMaxUsesPerUserError,
  PromoCodeInactiveError,
  PromoCodeNotApplicableError,
  PromoCodeMinimumNotMetError,
} from '../types/promo-code.types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NOW = new Date('2026-04-04T12:00:00Z');

function makeCode(overrides: Partial<PromoCode> = {}): PromoCode {
  return {
    id: 'pc-1',
    code: 'TEST20',
    type: 'percentage',
    discount_value: 20,
    max_uses: null,
    max_uses_per_user: null,
    uses_count: 0,
    valid_from: new Date('2026-01-01T00:00:00Z'),
    valid_until: null,
    min_quantity: 1,
    min_order_amount: 0,
    applicable_ticket_type_ids: null,
    applicable_event_ids: null,
    stackable: false,
    active: true,
    created_by_organizer_id: 'org-1',
    created_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeRequest(overrides: Partial<ApplyPromoCodeRequest> = {}): ApplyPromoCodeRequest {
  return {
    code: 'TEST20',
    user_id: 'user-1',
    order_items: [
      { ticket_type_id: 'tt-1', event_id: 'ev-1', quantity: 2, unit_price: 50000 },
    ],
    ...overrides,
  };
}

// ─── validatePromoCodeRules ───────────────────────────────────────────────────

describe('validatePromoCodeRules', () => {
  it('passes for a valid active code', () => {
    expect(() =>
      validatePromoCodeRules(makeCode(), makeRequest(), 0, NOW),
    ).not.toThrow();
  });

  it('throws PromoCodeInactiveError when code is inactive', () => {
    expect(() =>
      validatePromoCodeRules(makeCode({ active: false }), makeRequest(), 0, NOW),
    ).toThrow(PromoCodeInactiveError);
  });

  it('throws PromoCodeNotYetValidError when now is before valid_from', () => {
    const code = makeCode({ valid_from: new Date('2026-12-01T00:00:00Z') });
    expect(() => validatePromoCodeRules(code, makeRequest(), 0, NOW)).toThrow(
      PromoCodeNotYetValidError,
    );
  });

  it('throws PromoCodeExpiredError when now is after valid_until', () => {
    const code = makeCode({ valid_until: new Date('2025-01-01T00:00:00Z') });
    expect(() => validatePromoCodeRules(code, makeRequest(), 0, NOW)).toThrow(
      PromoCodeExpiredError,
    );
  });

  it('does not throw when valid_until is null (no expiry)', () => {
    expect(() =>
      validatePromoCodeRules(makeCode({ valid_until: null }), makeRequest(), 0, NOW),
    ).not.toThrow();
  });

  it('throws PromoCodeMaxUsesError when global limit exceeded', () => {
    const code = makeCode({ max_uses: 10, uses_count: 10 });
    expect(() => validatePromoCodeRules(code, makeRequest(), 0, NOW)).toThrow(
      PromoCodeMaxUsesError,
    );
  });

  it('does not throw when uses_count is one below max_uses', () => {
    const code = makeCode({ max_uses: 10, uses_count: 9 });
    expect(() => validatePromoCodeRules(code, makeRequest(), 0, NOW)).not.toThrow();
  });

  it('throws PromoCodeMaxUsesPerUserError when per-user limit exceeded', () => {
    const code = makeCode({ max_uses_per_user: 1 });
    expect(() => validatePromoCodeRules(code, makeRequest(), 1, NOW)).toThrow(
      PromoCodeMaxUsesPerUserError,
    );
  });

  it('throws PromoCodeMinimumNotMetError when quantity below min_quantity', () => {
    const code = makeCode({ min_quantity: 5 });
    const req = makeRequest({
      order_items: [{ ticket_type_id: 'tt-1', event_id: 'ev-1', quantity: 2, unit_price: 50000 }],
    });
    expect(() => validatePromoCodeRules(code, req, 0, NOW)).toThrow(
      PromoCodeMinimumNotMetError,
    );
  });

  it('throws PromoCodeMinimumNotMetError when order amount below min_order_amount', () => {
    const code = makeCode({ min_order_amount: 500000 }); // 5000 Kč
    const req = makeRequest({
      order_items: [{ ticket_type_id: 'tt-1', event_id: 'ev-1', quantity: 1, unit_price: 10000 }],
    });
    expect(() => validatePromoCodeRules(code, req, 0, NOW)).toThrow(
      PromoCodeMinimumNotMetError,
    );
  });

  it('throws PromoCodeNotApplicableError when no items match applicable_event_ids', () => {
    const code = makeCode({ applicable_event_ids: ['ev-999'] });
    expect(() => validatePromoCodeRules(code, makeRequest(), 0, NOW)).toThrow(
      PromoCodeNotApplicableError,
    );
  });

  it('throws PromoCodeNotApplicableError when no items match applicable_ticket_type_ids', () => {
    const code = makeCode({ applicable_ticket_type_ids: ['tt-999'] });
    expect(() => validatePromoCodeRules(code, makeRequest(), 0, NOW)).toThrow(
      PromoCodeNotApplicableError,
    );
  });
});

// ─── calculateDiscount — percentage ──────────────────────────────────────────

describe('calculateDiscount — percentage', () => {
  it('applies 20% discount to all items', () => {
    const code = makeCode({ type: 'percentage', discount_value: 20 });
    const req = makeRequest({
      order_items: [{ ticket_type_id: 'tt-1', event_id: 'ev-1', quantity: 2, unit_price: 50000 }],
    });
    const result = calculateDiscount(code, req);
    expect(result.original_total).toBe(100000);
    expect(result.discount_amount).toBe(20000);
    expect(result.final_total).toBe(80000);
    expect(result.message).toBe('Sleva 20 % byla uplatněna');
  });

  it('rounds percentage discount down (floor) to whole haléře', () => {
    // 20% of 333 = 66.6 → floor to 66
    const code = makeCode({ type: 'percentage', discount_value: 20 });
    const req = makeRequest({
      order_items: [{ ticket_type_id: 'tt-1', event_id: 'ev-1', quantity: 1, unit_price: 333 }],
    });
    const result = calculateDiscount(code, req);
    expect(result.discount_amount).toBe(66);
    expect(result.final_total).toBe(267);
  });

  it('only applies percentage to applicable_ticket_type_ids', () => {
    const code = makeCode({
      type: 'percentage',
      discount_value: 50,
      applicable_ticket_type_ids: ['tt-1'],
    });
    const req = makeRequest({
      order_items: [
        { ticket_type_id: 'tt-1', event_id: 'ev-1', quantity: 1, unit_price: 10000 },
        { ticket_type_id: 'tt-2', event_id: 'ev-1', quantity: 1, unit_price: 10000 },
      ],
    });
    const result = calculateDiscount(code, req);
    expect(result.original_total).toBe(20000);
    expect(result.discount_amount).toBe(5000);
    expect(result.final_total).toBe(15000);
    const tt2 = result.applied_to_items.find((i) => i.ticket_type_id === 'tt-2');
    expect(tt2?.discounted).toBe(10000); // no discount
  });
});

// ─── calculateDiscount — fixed ────────────────────────────────────────────────

describe('calculateDiscount — fixed', () => {
  it('subtracts a fixed amount from applicable items', () => {
    const code = makeCode({ type: 'fixed', discount_value: 5000 }); // 50 Kč
    const req = makeRequest({
      order_items: [{ ticket_type_id: 'tt-1', event_id: 'ev-1', quantity: 2, unit_price: 50000 }],
    });
    const result = calculateDiscount(code, req);
    expect(result.discount_amount).toBe(5000);
    expect(result.final_total).toBe(95000);
  });

  it('fixed discount larger than order total clamps to 0', () => {
    const code = makeCode({ type: 'fixed', discount_value: 999999 });
    const req = makeRequest({
      order_items: [{ ticket_type_id: 'tt-1', event_id: 'ev-1', quantity: 1, unit_price: 1000 }],
    });
    const result = calculateDiscount(code, req);
    expect(result.final_total).toBe(0);
    expect(result.discount_amount).toBe(1000); // capped at line total
  });
});

// ─── calculateDiscount — bogo ─────────────────────────────────────────────────

describe('calculateDiscount — bogo', () => {
  it('gives 1 free for every 2 units (even quantity)', () => {
    const code = makeCode({ type: 'bogo', discount_value: 0 });
    const req = makeRequest({
      order_items: [{ ticket_type_id: 'tt-1', event_id: 'ev-1', quantity: 4, unit_price: 30000 }],
    });
    const result = calculateDiscount(code, req);
    // 4 units → 2 free → 2 * 30000 = 60000 discount
    expect(result.discount_amount).toBe(60000);
    expect(result.final_total).toBe(60000);
    expect(result.message).toBe('Akce 2+1 zdarma byla uplatněna');
  });

  it('handles odd quantity: 3 units → 1 free', () => {
    const code = makeCode({ type: 'bogo', discount_value: 0 });
    const req = makeRequest({
      order_items: [{ ticket_type_id: 'tt-1', event_id: 'ev-1', quantity: 3, unit_price: 30000 }],
    });
    const result = calculateDiscount(code, req);
    // floor(3/2) = 1 free → 30000 discount
    expect(result.discount_amount).toBe(30000);
    expect(result.final_total).toBe(60000);
  });

  it('handles quantity 1: no free tickets', () => {
    const code = makeCode({ type: 'bogo', discount_value: 0 });
    const req = makeRequest({
      order_items: [{ ticket_type_id: 'tt-1', event_id: 'ev-1', quantity: 1, unit_price: 30000 }],
    });
    const result = calculateDiscount(code, req);
    expect(result.discount_amount).toBe(0);
    expect(result.final_total).toBe(30000);
  });
});

// ─── calculateDiscount — free ─────────────────────────────────────────────────

describe('calculateDiscount — free', () => {
  it('makes all applicable items free', () => {
    const code = makeCode({ type: 'free', discount_value: 0 });
    const req = makeRequest({
      order_items: [
        { ticket_type_id: 'tt-1', event_id: 'ev-1', quantity: 2, unit_price: 50000 },
      ],
    });
    const result = calculateDiscount(code, req);
    expect(result.final_total).toBe(0);
    expect(result.discount_amount).toBe(100000);
    expect(result.message).toBe('Vstup zdarma byl uplatněn');
  });

  it('only makes applicable ticket types free', () => {
    const code = makeCode({
      type: 'free',
      discount_value: 0,
      applicable_ticket_type_ids: ['tt-1'],
    });
    const req = makeRequest({
      order_items: [
        { ticket_type_id: 'tt-1', event_id: 'ev-1', quantity: 1, unit_price: 20000 },
        { ticket_type_id: 'tt-2', event_id: 'ev-1', quantity: 1, unit_price: 30000 },
      ],
    });
    const result = calculateDiscount(code, req);
    expect(result.discount_amount).toBe(20000);
    expect(result.final_total).toBe(30000);
  });
});

// ─── generatePromoCode ────────────────────────────────────────────────────────

describe('generatePromoCode', () => {
  it('generates a code of default length 8', () => {
    const code = generatePromoCode();
    expect(code).toHaveLength(8);
  });

  it('generates a code of specified length', () => {
    expect(generatePromoCode(4)).toHaveLength(4);
    expect(generatePromoCode(12)).toHaveLength(12);
    expect(generatePromoCode(20)).toHaveLength(20);
  });

  it('generates only uppercase alphanumeric characters (hex)', () => {
    for (let i = 0; i < 20; i++) {
      expect(generatePromoCode()).toMatch(/^[A-F0-9]+$/);
    }
  });

  it('generates different codes on successive calls', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generatePromoCode()));
    expect(codes.size).toBeGreaterThan(90); // extremely unlikely to collide 10+ times
  });

  it('throws RangeError for length below 4', () => {
    expect(() => generatePromoCode(3)).toThrow(RangeError);
  });

  it('throws RangeError for length above 20', () => {
    expect(() => generatePromoCode(21)).toThrow(RangeError);
  });
});
