// Pure calculation and validation functions for group tickets.
// No side effects, no DB access — safe to call anywhere, trivial to unit-test.

import type { GroupTicketType, GroupMember, GroupOrder } from '../types/group-ticket.types';
import {
  GroupQuantityError,
  GroupMemberListError,
} from '../types/group-ticket.types';

// ---------------------------------------------------------------------------
// validateGroupQuantity
// ---------------------------------------------------------------------------

/**
 * Validates that `requestedQty` is within the allowed range for the given
 * group ticket type.
 *
 * Rules:
 *  - fixed    → quantity must equal exactly min_quantity
 *  - flexible → min_quantity ≤ quantity ≤ max_quantity
 *  - open     → quantity ≥ min_quantity (no upper bound)
 *
 * @throws {GroupQuantityError} when the quantity is outside the allowed range
 */
export function validateGroupQuantity(
  ticketType: GroupTicketType,
  requestedQty: number,
): void {
  const { group_type, min_quantity, max_quantity } = ticketType;

  if (!Number.isInteger(requestedQty) || requestedQty <= 0) {
    throw new GroupQuantityError(
      `Quantity must be a positive integer, got ${requestedQty}.`,
    );
  }

  if (group_type === 'fixed') {
    if (requestedQty !== min_quantity) {
      throw new GroupQuantityError(
        `Fixed group requires exactly ${min_quantity} members, got ${requestedQty}.`,
      );
    }
    return;
  }

  if (requestedQty < min_quantity) {
    throw new GroupQuantityError(
      `Minimum quantity for this group is ${min_quantity}, got ${requestedQty}.`,
    );
  }

  if (group_type === 'flexible') {
    // max_quantity is guaranteed non-null for flexible groups; guard defensively
    if (max_quantity !== null && requestedQty > max_quantity) {
      throw new GroupQuantityError(
        `Maximum quantity for this group is ${max_quantity}, got ${requestedQty}.`,
      );
    }
    return;
  }

  // group_type === 'open': only lower bound applies — already checked above
}

// ---------------------------------------------------------------------------
// calculateGroupTotal
// ---------------------------------------------------------------------------

/**
 * Returns the total amount in haléře for the given quantity and ticket type.
 * Both inputs are assumed to be already validated.
 */
export function calculateGroupTotal(
  ticketType: GroupTicketType,
  quantity: number,
): number {
  return ticketType.price_per_person * quantity;
}

// ---------------------------------------------------------------------------
// validateMemberList
// ---------------------------------------------------------------------------

/**
 * Validates the provided `members` array against the ticket type rules and
 * the actual requested `quantity`.
 *
 * When `requires_member_list` is true:
 *  - The list must be provided and non-empty.
 *  - Its length must equal `quantity`.
 *  - Each member must have a non-empty `name`.
 *
 * When `requires_member_list` is false:
 *  - An empty array (or an array shorter than `quantity`) is accepted;
 *    callers should use `generateMemberPlaceholders` in that case.
 *  - If a list IS supplied it must still match `quantity` (all-or-nothing).
 *
 * @throws {GroupMemberListError}
 */
export function validateMemberList(
  ticketType: GroupTicketType,
  members: GroupMember[],
  quantity: number,
): void {
  if (ticketType.requires_member_list) {
    if (!members || members.length === 0) {
      throw new GroupMemberListError(
        'A member list is required for this group ticket type.',
      );
    }

    if (members.length !== quantity) {
      throw new GroupMemberListError(
        `Member list length (${members.length}) does not match requested quantity (${quantity}).`,
      );
    }

    members.forEach((m, idx) => {
      if (!m.name || m.name.trim() === '') {
        throw new GroupMemberListError(
          `Member at index ${idx} is missing a name.`,
        );
      }
    });

    return;
  }

  // requires_member_list === false: partial or empty list is fine, but if a
  // list is supplied it must be the correct length (prevents silent mismatches)
  if (members && members.length > 0 && members.length !== quantity) {
    throw new GroupMemberListError(
      `Partial member list supplied (${members.length} entries) but quantity is ${quantity}. ` +
      'Either omit the list or provide an entry for every member.',
    );
  }
}

// ---------------------------------------------------------------------------
// generateMemberPlaceholders
// ---------------------------------------------------------------------------

/**
 * Generates placeholder GroupMember objects when a member list is not required.
 * Names are Czech-style: "Člen 1", "Člen 2", …
 */
export function generateMemberPlaceholders(quantity: number): GroupMember[] {
  return Array.from({ length: quantity }, (_, i) => ({
    name: `Člen ${i + 1}`,
    email: null,
  }));
}

// ---------------------------------------------------------------------------
// formatGroupSummary
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable one-liner summarising the group order.
 *
 * Czech:   "Skupinová vstupenka pro 15 osob — 3 750 Kč"
 * English: "Group ticket for 15 persons — CZK 37.50"
 *
 * Note: amounts are stored in haléře; the summary converts to whole Kč/CZK.
 */
export function formatGroupSummary(
  order: GroupOrder,
  lang: 'cs' | 'en',
): string {
  // Convert haléře to crowns; use integer division (haléře are always whole)
  const kc = order.total_amount / 100;

  if (lang === 'cs') {
    const formatted = new Intl.NumberFormat('cs-CZ', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(kc);
    return `Skupinová vstupenka pro ${order.quantity} ${personWordCs(order.quantity)} — ${formatted} Kč`;
  }

  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(kc);
  return `Group ticket for ${order.quantity} ${order.quantity === 1 ? 'person' : 'persons'} — CZK ${formatted}`;
}

/** Czech grammatical forms for "osoba/osoby/osob" */
function personWordCs(n: number): string {
  if (n === 1) return 'osobu';
  if (n >= 2 && n <= 4) return 'osoby';
  return 'osob';
}
