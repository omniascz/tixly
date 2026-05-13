// Group ticket domain types
// All monetary values in haléře (integer cents of CZK)

export type GroupType = 'fixed' | 'flexible' | 'open';

export type GroupOrderStatus = 'pending' | 'confirmed' | 'cancelled';

// ---------------------------------------------------------------------------
// Core domain models
// ---------------------------------------------------------------------------

export interface GroupTicketType {
  id: string;
  event_id: string;
  /** Human-readable label, e.g. "Skupinová vstupenka (10–30 osob)" */
  name: string;
  description: string | null;
  /**
   * fixed    — quantity must equal exactly min_quantity
   * flexible — quantity must be within [min_quantity, max_quantity]
   * open     — quantity must be >= min_quantity; max_quantity is null
   */
  group_type: GroupType;
  /** Minimum number of members required to form a group */
  min_quantity: number;
  /** Maximum number of members; null for open groups */
  max_quantity: number | null;
  /** Price per person in haléře */
  price_per_person: number;
  /** How many distinct group orders can be sold (not total persons) */
  total_quantity: number;
  /** Number of group orders already sold */
  sold_count: number;
  active: boolean;
  /** When true, members list must be provided at purchase time */
  requires_member_list: boolean;
}

export interface GroupMember {
  name: string;
  email: string | null;
}

export interface GroupOrder {
  id: string;
  group_ticket_type_id: string;
  event_id: string;
  /** User ID of the group leader who pays for the whole order */
  leader_user_id: string;
  /** Actual number of persons in this group */
  quantity: number;
  /** Price-per-person snapshot at the moment of purchase (haléře) */
  price_per_person: number;
  /** Total amount charged: quantity × price_per_person (haléře) */
  total_amount: number;
  status: GroupOrderStatus;
  members: GroupMember[];
  /** Individual ticket IDs issued — one per member */
  ticket_ids: string[];
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Typed errors — each carries an HTTP status code for easy mapping in routes
// ---------------------------------------------------------------------------

abstract class GroupError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * 422 — Requested quantity is outside the allowed min–max range for this
 * group ticket type (also thrown when a fixed group receives a different qty).
 */
export class GroupQuantityError extends GroupError {
  readonly statusCode = 422;
  readonly code = 'GROUP_QUANTITY_ERROR';
}

/**
 * 409 — All group slots for this ticket type have been sold out.
 */
export class GroupCapacityError extends GroupError {
  readonly statusCode = 409;
  readonly code = 'GROUP_CAPACITY_ERROR';
}

/**
 * 422 — Member list is required but missing, or its length does not match
 * the requested quantity.
 */
export class GroupMemberListError extends GroupError {
  readonly statusCode = 422;
  readonly code = 'GROUP_MEMBER_LIST_ERROR';
}

/**
 * 404 — No group order found for the given ID.
 */
export class GroupOrderNotFoundError extends GroupError {
  readonly statusCode = 404;
  readonly code = 'GROUP_ORDER_NOT_FOUND';
}

/**
 * 403 — The requesting user is not the group leader or an event organizer
 * and therefore is not permitted to perform this action.
 */
export class GroupUnauthorizedError extends GroupError {
  readonly statusCode = 403;
  readonly code = 'GROUP_UNAUTHORIZED';
}

/**
 * 404 — Group ticket type not found.
 */
export class GroupTicketTypeNotFoundError extends GroupError {
  readonly statusCode = 404;
  readonly code = 'GROUP_TICKET_TYPE_NOT_FOUND';
}

// ---------------------------------------------------------------------------
// HTTP error mapping helper — used by all API route handlers
// ---------------------------------------------------------------------------

export function groupErrorToHttp(err: unknown): { status: number; body: { error: string; code: string } } {
  if (err instanceof GroupError) {
    return {
      status: err.statusCode,
      body: { error: err.message, code: err.code },
    };
  }
  console.error('[group-tickets] Unhandled error:', err);
  return {
    status: 500,
    body: { error: 'Internal server error', code: 'INTERNAL_ERROR' },
  };
}
