// Pure functions for gift voucher code generation, validation, and business logic.
// No I/O — everything here is deterministic and easily testable.

import type { GiftVoucher, RedeemVoucherRequest } from '../types/gift-voucher.types';
import {
  VoucherExpiredError,
  VoucherAlreadyRedeemedError,
  VoucherCancelledError,
  VoucherNotApplicableError,
  VoucherInsufficientValueError,
} from '../types/gift-voucher.types';

// ---------------------------------------------------------------------------
// Character set
// Excludes O, 0, I, 1 to avoid confusion when reading/typing codes manually.
// ---------------------------------------------------------------------------

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Pattern: 4 groups of 4 alphanumeric characters separated by hyphens.
const CODE_REGEX = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

// ---------------------------------------------------------------------------
// generateVoucherCode
// ---------------------------------------------------------------------------

/**
 * Generates a random 16-character voucher code in XXXX-XXXX-XXXX-XXXX format.
 * Uses only uppercase letters and digits, excluding O, 0, I, 1.
 */
export function generateVoucherCode(): string {
  const segments: string[] = [];

  for (let s = 0; s < 4; s++) {
    let segment = '';
    for (let i = 0; i < 4; i++) {
      // Math.random is good enough for non-cryptographic voucher codes.
      // For higher-security requirements swap with crypto.getRandomValues.
      segment += CHARSET[Math.floor(Math.random() * CHARSET.length)];
    }
    segments.push(segment);
  }

  return segments.join('-');
}

// ---------------------------------------------------------------------------
// validateVoucherCode
// ---------------------------------------------------------------------------

/**
 * Returns true if `code` matches the XXXX-XXXX-XXXX-XXXX format using only
 * the allowed character set (no O, 0, I, 1).
 */
export function validateVoucherCode(code: string): boolean {
  return CODE_REGEX.test(code);
}

// ---------------------------------------------------------------------------
// calculateAppliedAmount
// ---------------------------------------------------------------------------

/**
 * Returns how many haléře to subtract from the voucher.
 * - For partial-value redemption: min(remaining_value, orderTotal).
 * - Ticket vouchers (full-cover): always returns remaining_value (the full face value),
 *   regardless of orderTotal, because the caller must validate applicability first.
 */
export function calculateAppliedAmount(voucher: GiftVoucher, orderTotal: number): number {
  return Math.min(voucher.remaining_value, orderTotal);
}

// ---------------------------------------------------------------------------
// isVoucherApplicableToItems
// ---------------------------------------------------------------------------

/**
 * Checks whether the voucher can be applied to at least one item in the order.
 *
 * - 'value' vouchers are always applicable (no restriction).
 * - 'event_specific' vouchers require at least one item matching applicable_event_id.
 * - 'ticket' vouchers require at least one item matching applicable_ticket_type_id.
 */
export function isVoucherApplicableToItems(
  voucher: GiftVoucher,
  items: RedeemVoucherRequest['order_items'],
): boolean {
  if (voucher.type === 'value') {
    return true;
  }

  if (voucher.type === 'event_specific') {
    return items.some((item) => item.event_id === voucher.applicable_event_id);
  }

  // ticket
  return items.some((item) => item.ticket_type_id === voucher.applicable_ticket_type_id);
}

// ---------------------------------------------------------------------------
// validateVoucherApplicability
// ---------------------------------------------------------------------------

/**
 * Validates that the voucher can be redeemed for the given request at time `now`.
 * Throws a typed error for each failure mode; returns void on success.
 */
export function validateVoucherApplicability(
  voucher: GiftVoucher,
  request: RedeemVoucherRequest,
  now: Date,
): void {
  if (voucher.status === 'expired' || now > voucher.valid_until) {
    throw new VoucherExpiredError(`Voucher ${voucher.code} has expired.`);
  }

  if (voucher.status === 'redeemed') {
    throw new VoucherAlreadyRedeemedError(`Voucher ${voucher.code} has already been fully redeemed.`);
  }

  if (voucher.status === 'cancelled') {
    throw new VoucherCancelledError(`Voucher ${voucher.code} has been cancelled.`);
  }

  if (voucher.remaining_value === 0) {
    throw new VoucherInsufficientValueError(`Voucher ${voucher.code} has no remaining value.`);
  }

  if (!isVoucherApplicableToItems(voucher, request.order_items)) {
    throw new VoucherNotApplicableError(
      `Voucher ${voucher.code} is not applicable to the items in this order.`,
    );
  }
}

// ---------------------------------------------------------------------------
// formatVoucherValue
// ---------------------------------------------------------------------------

/**
 * Formats a minor-unit value for display using Intl.NumberFormat.
 * currency: ISO 4217 code (CZK, EUR, USD, …)
 * locale: BCP 47 locale string (cs, en, de, …)
 * Examples (CZK, cs):
 *   50000 → "500 Kč"
 *   550   → "5,50 Kč"
 */
export function formatVoucherValue(
  value: number,
  currency = 'CZK',
  locale = 'cs',
): string {
  const minorUnitDivisor = currency === 'JPY' ? 1 : 100;
  const amount = value / minorUnitDivisor;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: currency === 'JPY' ? 0 : undefined,
  }).format(amount);
}
