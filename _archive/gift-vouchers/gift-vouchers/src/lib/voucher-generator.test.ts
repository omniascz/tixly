import { describe, it, expect } from 'vitest';
import {
  generateVoucherCode,
  validateVoucherCode,
  calculateAppliedAmount,
  validateVoucherApplicability,
  isVoucherApplicableToItems,
  formatVoucherValue,
} from './voucher-generator';
import type { GiftVoucher, RedeemVoucherRequest } from '../types/gift-voucher.types';
import {
  VoucherExpiredError,
  VoucherAlreadyRedeemedError,
  VoucherCancelledError,
  VoucherNotApplicableError,
  VoucherInsufficientValueError,
} from '../types/gift-voucher.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVoucher(overrides: Partial<GiftVoucher> = {}): GiftVoucher {
  return {
    id: 'v-001',
    code: 'ABCD-EFGH-JKLM-NPQR',
    type: 'value',
    status: 'issued',
    initial_value: 50000,
    remaining_value: 50000,
    currency: 'CZK',
    purchaser_user_id: 'user-1',
    recipient_email: null,
    recipient_name: null,
    applicable_event_id: null,
    applicable_ticket_type_id: null,
    valid_until: new Date('2030-01-01'),
    issued_at: new Date('2026-04-04'),
    sent_at: null,
    redeemed_at: null,
    redemption_order_id: null,
    personal_message: null,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<RedeemVoucherRequest> = {}): RedeemVoucherRequest {
  return {
    code: 'ABCD-EFGH-JKLM-NPQR',
    order_items: [{ ticket_type_id: 'tt-1', event_id: 'ev-1', quantity: 1, unit_price: 30000 }],
    user_id: 'user-2',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// generateVoucherCode
// ---------------------------------------------------------------------------

describe('generateVoucherCode', () => {
  it('returns a string in XXXX-XXXX-XXXX-XXXX format', () => {
    const code = generateVoucherCode();
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('contains exactly 3 hyphens', () => {
    const code = generateVoucherCode();
    const hyphens = (code.match(/-/g) ?? []).length;
    expect(hyphens).toBe(3);
  });

  it('has total length 19 (16 chars + 3 hyphens)', () => {
    const code = generateVoucherCode();
    expect(code).toHaveLength(19);
  });

  it('never contains forbidden character O', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateVoucherCode()).not.toContain('O');
    }
  });

  it('never contains forbidden character 0 (zero)', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateVoucherCode()).not.toContain('0');
    }
  });

  it('never contains forbidden character I', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateVoucherCode()).not.toContain('I');
    }
  });

  it('never contains forbidden character 1 (one)', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateVoucherCode()).not.toContain('1');
    }
  });

  it('generates unique codes across many calls', () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateVoucherCode()));
    // Extremely unlikely to have any collisions in 1000 draws from ~32^16 space
    expect(codes.size).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// validateVoucherCode
// ---------------------------------------------------------------------------

describe('validateVoucherCode', () => {
  it('accepts a valid code', () => {
    expect(validateVoucherCode('ABCD-EFGH-JKLM-NPQR')).toBe(true);
  });

  it('accepts all allowed characters', () => {
    expect(validateVoucherCode('ABCD-EFGH-JKLM-NPQR')).toBe(true);
    expect(validateVoucherCode('2345-6789-WXYZ-UVST')).toBe(true);
  });

  it('rejects code containing O', () => {
    expect(validateVoucherCode('ABCO-EFGH-JKLM-NPQR')).toBe(false);
  });

  it('rejects code containing 0 (zero)', () => {
    expect(validateVoucherCode('ABC0-EFGH-JKLM-NPQR')).toBe(false);
  });

  it('rejects code containing I', () => {
    expect(validateVoucherCode('ABCI-EFGH-JKLM-NPQR')).toBe(false);
  });

  it('rejects code containing 1 (one)', () => {
    expect(validateVoucherCode('ABC1-EFGH-JKLM-NPQR')).toBe(false);
  });

  it('rejects lowercase letters', () => {
    expect(validateVoucherCode('abcd-EFGH-JKLM-NPQR')).toBe(false);
  });

  it('rejects wrong segment length', () => {
    expect(validateVoucherCode('ABCDE-FGH-JKLM-NPQR')).toBe(false);
  });

  it('rejects missing hyphens', () => {
    expect(validateVoucherCode('ABCDEFGHJKLMNPQR')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(validateVoucherCode('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// calculateAppliedAmount
// ---------------------------------------------------------------------------

describe('calculateAppliedAmount', () => {
  it('returns remaining_value when orderTotal >= remaining_value (full redemption)', () => {
    const voucher = makeVoucher({ remaining_value: 50000 });
    expect(calculateAppliedAmount(voucher, 60000)).toBe(50000);
  });

  it('returns orderTotal when orderTotal < remaining_value (partial redemption)', () => {
    const voucher = makeVoucher({ remaining_value: 50000 });
    expect(calculateAppliedAmount(voucher, 30000)).toBe(30000);
  });

  it('returns exact amount when orderTotal === remaining_value', () => {
    const voucher = makeVoucher({ remaining_value: 50000 });
    expect(calculateAppliedAmount(voucher, 50000)).toBe(50000);
  });
});

// ---------------------------------------------------------------------------
// validateVoucherApplicability
// ---------------------------------------------------------------------------

describe('validateVoucherApplicability', () => {
  const now = new Date('2026-04-04T12:00:00Z');

  it('does not throw for a valid issued voucher with matching items', () => {
    const voucher = makeVoucher();
    const request = makeRequest();
    expect(() => validateVoucherApplicability(voucher, request, now)).not.toThrow();
  });

  it('does not throw for a valid sent voucher', () => {
    const voucher = makeVoucher({ status: 'sent', sent_at: new Date() });
    const request = makeRequest();
    expect(() => validateVoucherApplicability(voucher, request, now)).not.toThrow();
  });

  it('throws VoucherExpiredError when status is expired', () => {
    const voucher = makeVoucher({ status: 'expired' });
    expect(() => validateVoucherApplicability(voucher, makeRequest(), now)).toThrow(VoucherExpiredError);
  });

  it('throws VoucherExpiredError when valid_until is in the past', () => {
    const voucher = makeVoucher({ valid_until: new Date('2025-01-01') });
    expect(() => validateVoucherApplicability(voucher, makeRequest(), now)).toThrow(VoucherExpiredError);
  });

  it('throws VoucherAlreadyRedeemedError when status is redeemed', () => {
    const voucher = makeVoucher({ status: 'redeemed', remaining_value: 0 });
    expect(() => validateVoucherApplicability(voucher, makeRequest(), now)).toThrow(VoucherAlreadyRedeemedError);
  });

  it('throws VoucherCancelledError when status is cancelled', () => {
    const voucher = makeVoucher({ status: 'cancelled' });
    expect(() => validateVoucherApplicability(voucher, makeRequest(), now)).toThrow(VoucherCancelledError);
  });

  it('throws VoucherInsufficientValueError when remaining_value is 0 and status is issued', () => {
    const voucher = makeVoucher({ remaining_value: 0 });
    expect(() => validateVoucherApplicability(voucher, makeRequest(), now)).toThrow(VoucherInsufficientValueError);
  });

  it('throws VoucherNotApplicableError for event_specific voucher with wrong event', () => {
    const voucher = makeVoucher({ type: 'event_specific', applicable_event_id: 'ev-OTHER' });
    const request = makeRequest(); // items have event_id: 'ev-1'
    expect(() => validateVoucherApplicability(voucher, request, now)).toThrow(VoucherNotApplicableError);
  });

  it('does not throw for event_specific voucher with matching event', () => {
    const voucher = makeVoucher({ type: 'event_specific', applicable_event_id: 'ev-1' });
    const request = makeRequest();
    expect(() => validateVoucherApplicability(voucher, request, now)).not.toThrow();
  });

  it('throws VoucherNotApplicableError for ticket voucher with wrong ticket_type_id', () => {
    const voucher = makeVoucher({ type: 'ticket', applicable_ticket_type_id: 'tt-OTHER' });
    const request = makeRequest(); // items have ticket_type_id: 'tt-1'
    expect(() => validateVoucherApplicability(voucher, request, now)).toThrow(VoucherNotApplicableError);
  });

  it('does not throw for ticket voucher with matching ticket_type_id', () => {
    const voucher = makeVoucher({ type: 'ticket', applicable_ticket_type_id: 'tt-1' });
    const request = makeRequest();
    expect(() => validateVoucherApplicability(voucher, request, now)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// isVoucherApplicableToItems
// ---------------------------------------------------------------------------

describe('isVoucherApplicableToItems', () => {
  const items: RedeemVoucherRequest['order_items'] = [
    { ticket_type_id: 'tt-1', event_id: 'ev-1', quantity: 1, unit_price: 30000 },
    { ticket_type_id: 'tt-2', event_id: 'ev-2', quantity: 2, unit_price: 15000 },
  ];

  it('value voucher is always applicable', () => {
    expect(isVoucherApplicableToItems(makeVoucher({ type: 'value' }), items)).toBe(true);
  });

  it('value voucher is applicable even with no matching ids', () => {
    expect(isVoucherApplicableToItems(makeVoucher({ type: 'value' }), [])).toBe(true);
  });

  it('event_specific voucher matches when at least one item has the right event_id', () => {
    const voucher = makeVoucher({ type: 'event_specific', applicable_event_id: 'ev-2' });
    expect(isVoucherApplicableToItems(voucher, items)).toBe(true);
  });

  it('event_specific voucher does not match when no item has the right event_id', () => {
    const voucher = makeVoucher({ type: 'event_specific', applicable_event_id: 'ev-999' });
    expect(isVoucherApplicableToItems(voucher, items)).toBe(false);
  });

  it('ticket voucher matches when at least one item has the right ticket_type_id', () => {
    const voucher = makeVoucher({ type: 'ticket', applicable_ticket_type_id: 'tt-1' });
    expect(isVoucherApplicableToItems(voucher, items)).toBe(true);
  });

  it('ticket voucher does not match when no item has the right ticket_type_id', () => {
    const voucher = makeVoucher({ type: 'ticket', applicable_ticket_type_id: 'tt-999' });
    expect(isVoucherApplicableToItems(voucher, items)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatVoucherValue
// ---------------------------------------------------------------------------

describe('formatVoucherValue', () => {
  it('formats whole koruny without decimal places', () => {
    expect(formatVoucherValue(50000)).toBe('500 Kč');
  });

  it('formats 100 Kč', () => {
    expect(formatVoucherValue(10000)).toBe('100 Kč');
  });

  it('formats value with haléře using comma decimal separator', () => {
    expect(formatVoucherValue(550)).toBe('5,50 Kč');
  });

  it('formats 1 haléř', () => {
    expect(formatVoucherValue(1)).toBe('0,01 Kč');
  });

  it('formats 0', () => {
    expect(formatVoucherValue(0)).toBe('0 Kč');
  });
});
