// Pure calculation functions for flash sales.
// All monetary values are in haléře (1 CZK = 100 haléřů).
// No side effects, no I/O — safe to use in tests and in the browser.

import type { FlashSale, FlashSalePublicView } from '../types/flash-sale.types';
import { FlashSaleInvalidTimeError } from '../types/flash-sale.types';

// ---------------------------------------------------------------------------
// calculateFlashPrice
// ---------------------------------------------------------------------------

/**
 * Computes the flash price in haléře.
 *
 * - percentage: floor(originalPrice * (1 - discountValue / 100)), min 1
 * - fixed: originalPrice - discountValue, min 1
 */
export function calculateFlashPrice(
  originalPrice: number,
  discountType: 'percentage' | 'fixed',
  discountValue: number,
): number {
  let raw: number;

  if (discountType === 'percentage') {
    raw = Math.floor(originalPrice * (1 - discountValue / 100));
  } else {
    raw = originalPrice - discountValue;
  }

  return Math.max(1, raw);
}

// ---------------------------------------------------------------------------
// calculateDiscountPct
// ---------------------------------------------------------------------------

/**
 * Returns the effective discount as a whole-percentage integer.
 * e.g. originalPrice=10000, flashPrice=7500 → 25
 */
export function calculateDiscountPct(
  originalPrice: number,
  flashPrice: number,
): number {
  if (originalPrice <= 0) return 0;
  return Math.round(((originalPrice - flashPrice) / originalPrice) * 100);
}

// ---------------------------------------------------------------------------
// calculateSecondsRemaining
// ---------------------------------------------------------------------------

/**
 * Returns how many seconds remain until endsAt, relative to now.
 * Never negative — returns 0 when the sale has already ended.
 */
export function calculateSecondsRemaining(endsAt: Date, now: Date): number {
  const diff = Math.floor((endsAt.getTime() - now.getTime()) / 1000);
  return Math.max(0, diff);
}

// ---------------------------------------------------------------------------
// isFlashSaleActive
// ---------------------------------------------------------------------------

/**
 * Returns true only when all of the following hold:
 *   1. status === 'active'
 *   2. now is within [starts_at, ends_at)
 *   3. flash_sold_count < flash_capacity
 */
export function isFlashSaleActive(
  sale: Pick<
    FlashSale,
    'status' | 'starts_at' | 'ends_at' | 'flash_sold_count' | 'flash_capacity'
  >,
  now: Date,
): boolean {
  if (sale.status !== 'active') return false;
  if (now < sale.starts_at) return false;
  if (now >= sale.ends_at) return false;
  if (sale.flash_sold_count >= sale.flash_capacity) return false;
  return true;
}

// ---------------------------------------------------------------------------
// toPublicView
// ---------------------------------------------------------------------------

export function toPublicView(sale: FlashSale, now: Date): FlashSalePublicView {
  const remaining_count = Math.max(
    0,
    sale.flash_capacity - sale.flash_sold_count,
  );

  const seconds_remaining = calculateSecondsRemaining(sale.ends_at, now);
  const discount_pct = calculateDiscountPct(sale.original_price, sale.flash_price);

  let status: FlashSalePublicView['status'];

  if (remaining_count === 0) {
    status = 'sold_out';
  } else if (sale.status === 'active' && now < sale.ends_at) {
    status = 'active';
  } else {
    status = 'ended';
  }

  return {
    id: sale.id,
    name: sale.name,
    flash_price: sale.flash_price,
    original_price: sale.original_price,
    discount_pct,
    remaining_count,
    ends_at: sale.ends_at,
    seconds_remaining,
    status,
  };
}

// ---------------------------------------------------------------------------
// validateFlashSaleTimes
// ---------------------------------------------------------------------------

/**
 * Throws FlashSaleInvalidTimeError when:
 *   - starts_at is in the past (strictly before now)
 *   - ends_at <= starts_at
 */
export function validateFlashSaleTimes(
  startsAt: Date,
  endsAt: Date,
  now: Date,
): void {
  if (startsAt < now) {
    throw new FlashSaleInvalidTimeError(
      `starts_at (${startsAt.toISOString()}) must not be in the past.`,
    );
  }

  if (endsAt <= startsAt) {
    throw new FlashSaleInvalidTimeError(
      `ends_at (${endsAt.toISOString()}) must be strictly after starts_at (${startsAt.toISOString()}).`,
    );
  }
}
