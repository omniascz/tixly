import { randomBytes } from 'crypto';
import type {
  PromoCode,
  ApplyPromoCodeRequest,
  ApplyPromoCodeResult,
  AppliedItem,
  OrderItem,
} from '../types/promo-code.types';
import {
  PromoCodeExpiredError,
  PromoCodeNotYetValidError,
  PromoCodeMaxUsesError,
  PromoCodeMaxUsesPerUserError,
  PromoCodeInactiveError,
  PromoCodeNotApplicableError,
  PromoCodeMinimumNotMetError,
} from '../types/promo-code.types';

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validates all rule-based constraints for a promo code.
 * Throws a typed PromoCodeValidationError subclass on any violation.
 * Pure function — no side effects, no DB access.
 */
export function validatePromoCodeRules(
  promoCode: PromoCode,
  request: ApplyPromoCodeRequest,
  userUsesCount: number,
  now: Date,
): void {
  if (!promoCode.active) {
    throw new PromoCodeInactiveError(promoCode.code);
  }

  // Temporal window
  if (now < promoCode.valid_from) {
    throw new PromoCodeNotYetValidError(promoCode.code);
  }
  if (promoCode.valid_until !== null && now > promoCode.valid_until) {
    throw new PromoCodeExpiredError(promoCode.code);
  }

  // Global usage cap
  if (promoCode.max_uses !== null && promoCode.uses_count >= promoCode.max_uses) {
    throw new PromoCodeMaxUsesError(promoCode.code);
  }

  // Per-user usage cap
  if (
    promoCode.max_uses_per_user !== null &&
    userUsesCount >= promoCode.max_uses_per_user
  ) {
    throw new PromoCodeMaxUsesPerUserError(promoCode.code);
  }

  // Applicable events filter
  if (promoCode.applicable_event_ids !== null) {
    const allowedEvents = new Set(promoCode.applicable_event_ids);
    const allItemsApplicable = request.order_items.some((item) =>
      allowedEvents.has(item.event_id),
    );
    if (!allItemsApplicable) {
      throw new PromoCodeNotApplicableError(
        promoCode.code,
        'Promo kód nelze použít pro žádnou z vybraných akcí',
      );
    }
  }

  // Applicable ticket types filter
  if (promoCode.applicable_ticket_type_ids !== null) {
    const allowedTypes = new Set(promoCode.applicable_ticket_type_ids);
    const hasApplicableItem = request.order_items.some((item) =>
      allowedTypes.has(item.ticket_type_id),
    );
    if (!hasApplicableItem) {
      throw new PromoCodeNotApplicableError(
        promoCode.code,
        'Promo kód nelze použít pro žádný z vybraných typů vstupenek',
      );
    }
  }

  // Minimum quantity across applicable items
  const applicableItems = getApplicableItems(promoCode, request.order_items);
  const totalQuantity = applicableItems.reduce((sum, item) => sum + item.quantity, 0);
  if (totalQuantity < promoCode.min_quantity) {
    throw new PromoCodeMinimumNotMetError(
      promoCode.code,
      promoCode.min_quantity,
      promoCode.min_order_amount,
    );
  }

  // Minimum order amount across applicable items
  const totalAmount = applicableItems.reduce(
    (sum, item) => sum + item.quantity * item.unit_price,
    0,
  );
  if (totalAmount < promoCode.min_order_amount) {
    throw new PromoCodeMinimumNotMetError(
      promoCode.code,
      promoCode.min_quantity,
      promoCode.min_order_amount,
    );
  }
}

// ─── Discount calculation ────────────────────────────────────────────────────

/**
 * Calculates the discount for a given promo code and order.
 * Pure function — does not validate rules, does not touch the DB.
 * All monetary values are in haléře (integer).
 */
export function calculateDiscount(
  promoCode: PromoCode,
  request: ApplyPromoCodeRequest,
): ApplyPromoCodeResult {
  const applicableItems = getApplicableItems(promoCode, request.order_items);
  const allItems = request.order_items;

  const originalTotal = allItems.reduce(
    (sum, item) => sum + item.quantity * item.unit_price,
    0,
  );

  let appliedToItems: AppliedItem[];
  let discountAmount: number;

  switch (promoCode.type) {
    case 'percentage':
      ({ appliedToItems, discountAmount } = calcPercentage(
        promoCode.discount_value,
        applicableItems,
        allItems,
      ));
      break;
    case 'fixed':
      ({ appliedToItems, discountAmount } = calcFixed(
        promoCode.discount_value,
        applicableItems,
        allItems,
      ));
      break;
    case 'bogo':
      ({ appliedToItems, discountAmount } = calcBogo(applicableItems, allItems));
      break;
    case 'free':
      ({ appliedToItems, discountAmount } = calcFree(applicableItems, allItems));
      break;
  }

  const finalTotal = Math.max(0, originalTotal - discountAmount);

  return {
    promo_code_id: promoCode.id,
    code: promoCode.code,
    discount_type: promoCode.type,
    original_total: originalTotal,
    discount_amount: discountAmount,
    final_total: finalTotal,
    applied_to_items: appliedToItems,
    message: buildMessage(promoCode),
  };
}

// ─── Private helpers ─────────────────────────────────────────────────────────

function getApplicableItems(promoCode: PromoCode, items: OrderItem[]): OrderItem[] {
  return items.filter((item) => {
    if (
      promoCode.applicable_ticket_type_ids !== null &&
      !promoCode.applicable_ticket_type_ids.includes(item.ticket_type_id)
    ) {
      return false;
    }
    if (
      promoCode.applicable_event_ids !== null &&
      !promoCode.applicable_event_ids.includes(item.event_id)
    ) {
      return false;
    }
    return true;
  });
}

function calcPercentage(
  pct: number,
  applicableItems: OrderItem[],
  allItems: OrderItem[],
): { appliedToItems: AppliedItem[]; discountAmount: number } {
  const applicableSet = new Set(applicableItems.map((i) => i.ticket_type_id));
  let discountAmount = 0;

  const appliedToItems: AppliedItem[] = allItems.map((item) => {
    const lineTotal = item.quantity * item.unit_price;
    if (!applicableSet.has(item.ticket_type_id)) {
      return { ticket_type_id: item.ticket_type_id, original: lineTotal, discounted: lineTotal };
    }
    // Round down to whole haléře
    const lineDiscount = Math.floor((lineTotal * pct) / 100);
    discountAmount += lineDiscount;
    return {
      ticket_type_id: item.ticket_type_id,
      original: lineTotal,
      discounted: lineTotal - lineDiscount,
    };
  });

  return { appliedToItems, discountAmount };
}

function calcFixed(
  fixedAmount: number,
  applicableItems: OrderItem[],
  allItems: OrderItem[],
): { appliedToItems: AppliedItem[]; discountAmount: number } {
  // Distribute fixed discount proportionally across applicable items,
  // but cap each item's discount at its own line total.
  const applicableTotal = applicableItems.reduce(
    (sum, item) => sum + item.quantity * item.unit_price,
    0,
  );
  const actualDiscount = Math.min(fixedAmount, applicableTotal);
  const applicableSet = new Set(applicableItems.map((i) => i.ticket_type_id));

  let allocated = 0;
  const applicableItemsWithDiscount = applicableItems.map((item, idx) => {
    const lineTotal = item.quantity * item.unit_price;
    const isLast = idx === applicableItems.length - 1;
    const share = isLast
      ? actualDiscount - allocated
      : Math.floor((lineTotal / applicableTotal) * actualDiscount);
    allocated += share;
    return { ticket_type_id: item.ticket_type_id, original: lineTotal, discounted: lineTotal - share };
  });

  const discountMap = new Map(
    applicableItemsWithDiscount.map((i) => [i.ticket_type_id, i]),
  );

  const appliedToItems: AppliedItem[] = allItems.map((item) => {
    const mapped = discountMap.get(item.ticket_type_id);
    if (mapped) return mapped;
    const lineTotal = item.quantity * item.unit_price;
    return { ticket_type_id: item.ticket_type_id, original: lineTotal, discounted: lineTotal };
  });

  return { appliedToItems, discountAmount: actualDiscount };
}

function calcBogo(
  applicableItems: OrderItem[],
  allItems: OrderItem[],
): { appliedToItems: AppliedItem[]; discountAmount: number } {
  // For each applicable ticket type: every 2 units → 1 free (cheapest = unit_price)
  // Pair count = floor(quantity / 2), each pair grants 1 free unit at unit_price
  let discountAmount = 0;
  const discountByType = new Map<string, number>();

  for (const item of applicableItems) {
    const freePieces = Math.floor(item.quantity / 2);
    const lineDiscount = freePieces * item.unit_price;
    discountAmount += lineDiscount;
    discountByType.set(item.ticket_type_id, lineDiscount);
  }

  const applicableSet = new Set(applicableItems.map((i) => i.ticket_type_id));

  const appliedToItems: AppliedItem[] = allItems.map((item) => {
    const lineTotal = item.quantity * item.unit_price;
    if (!applicableSet.has(item.ticket_type_id)) {
      return { ticket_type_id: item.ticket_type_id, original: lineTotal, discounted: lineTotal };
    }
    const lineDiscount = discountByType.get(item.ticket_type_id) ?? 0;
    return {
      ticket_type_id: item.ticket_type_id,
      original: lineTotal,
      discounted: lineTotal - lineDiscount,
    };
  });

  return { appliedToItems, discountAmount };
}

function calcFree(
  applicableItems: OrderItem[],
  allItems: OrderItem[],
): { appliedToItems: AppliedItem[]; discountAmount: number } {
  const applicableSet = new Set(applicableItems.map((i) => i.ticket_type_id));
  let discountAmount = 0;

  const appliedToItems: AppliedItem[] = allItems.map((item) => {
    const lineTotal = item.quantity * item.unit_price;
    if (!applicableSet.has(item.ticket_type_id)) {
      return { ticket_type_id: item.ticket_type_id, original: lineTotal, discounted: lineTotal };
    }
    discountAmount += lineTotal;
    return { ticket_type_id: item.ticket_type_id, original: lineTotal, discounted: 0 };
  });

  return { appliedToItems, discountAmount };
}

function buildMessage(promoCode: PromoCode): string {
  switch (promoCode.type) {
    case 'percentage':
      return `Sleva ${promoCode.discount_value} % byla uplatněna`;
    case 'fixed': {
      const czk = (promoCode.discount_value / 100).toFixed(2).replace('.', ',');
      return `Sleva ${czk} Kč byla uplatněna`;
    }
    case 'bogo':
      return 'Akce 2+1 zdarma byla uplatněna';
    case 'free':
      return 'Vstup zdarma byl uplatněn';
  }
}

// ─── Code generation ─────────────────────────────────────────────────────────

/**
 * Generates a random promo code of the given length (default 8).
 * Output: uppercase hex characters (A-F, 0-9).
 * Length must be between 4 and 20.
 */
export function generatePromoCode(length = 8): string {
  if (length < 4 || length > 20) {
    throw new RangeError('Promo code length must be between 4 and 20');
  }
  // Each byte → 2 hex chars; generate enough bytes then slice
  const bytesNeeded = Math.ceil(length / 2);
  return randomBytes(bytesNeeded).toString('hex').toUpperCase().slice(0, length);
}
