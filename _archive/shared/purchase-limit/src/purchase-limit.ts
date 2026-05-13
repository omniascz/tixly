/**
 * Feature #54: Purchase Limit Enforcement
 *
 * Enforces a maximum number of tickets per verified user per event.
 * Typically max=4 tickets/user/event, applied only to verified accounts.
 */

export interface PurchaseLimitConfig {
  /** Max tickets per verified user per event. Default: 4. */
  maxTicketsPerUser: number;
  /** Whether to apply only to verified accounts (those with email_verified=true). */
  verifiedOnly: boolean;
}

export const DEFAULT_PURCHASE_LIMIT: PurchaseLimitConfig = {
  maxTicketsPerUser: 4,
  verifiedOnly: true,
};

/**
 * Database adapter for purchase limit enforcement.
 * Implementations query the orders and users tables.
 */
export interface PurchaseLimitDb {
  /**
   * Count total tickets purchased by userId for the given eventId
   * across all orders with status IN ('paid', 'pending').
   */
  countUserTicketsForEvent(userId: string, eventId: string): Promise<number>;

  /**
   * Check whether the user is verified (email_verified = true).
   */
  isUserVerified(userId: string): Promise<boolean>;
}

/**
 * Thrown when a user attempts to purchase more than the allowed
 * number of tickets per event per account.
 */
export class PurchaseLimitExceededError extends Error {
  readonly code = 'PURCHASE_LIMIT_EXCEEDED';
  readonly statusCode = 409;

  constructor(
    public readonly currentCount: number,
    public readonly attemptedCount: number,
    public readonly maxAllowed: number,
  ) {
    super(
      `Překročen limit ${maxAllowed} vstupenek na akci. ` +
      `Aktuálně máte ${currentCount}, pokoušíte se přidat ${attemptedCount}.`,
    );
  }
}

/**
 * Enforces the purchase limit for a given user and event.
 *
 * Throws PurchaseLimitExceededError if the user would exceed maxTicketsPerUser
 * for eventId after adding requestedQuantity tickets.
 *
 * If verifiedOnly=true and user is unverified, returns early (no enforcement).
 * Otherwise counts existing tickets and validates the request.
 *
 * @param userId - The purchasing user ID
 * @param eventId - The event ID
 * @param requestedQuantity - Number of tickets being requested
 * @param db - Database adapter
 * @param config - Purchase limit configuration (optional, uses default if omitted)
 *
 * @throws PurchaseLimitExceededError
 */
export async function enforcePurchaseLimit(
  userId: string,
  eventId: string,
  requestedQuantity: number,
  db: PurchaseLimitDb,
  config: PurchaseLimitConfig = DEFAULT_PURCHASE_LIMIT,
): Promise<void> {
  // Step 1: If verifiedOnly is true, check user verification status
  if (config.verifiedOnly) {
    const isVerified = await db.isUserVerified(userId);
    if (!isVerified) {
      // Unverified users skip enforcement (they may have other limits)
      return;
    }
  }

  // Step 2: Count existing tickets for this user/event
  const currentCount = await db.countUserTicketsForEvent(userId, eventId);

  // Step 3: Check if adding the requested quantity would exceed the limit
  const totalAfterRequest = currentCount + requestedQuantity;
  if (totalAfterRequest > config.maxTicketsPerUser) {
    throw new PurchaseLimitExceededError(currentCount, requestedQuantity, config.maxTicketsPerUser);
  }
}

export default {
  enforcePurchaseLimit,
  PurchaseLimitExceededError,
  DEFAULT_PURCHASE_LIMIT,
};
