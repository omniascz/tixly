import type { InventoryHoldback } from '../types/holdback.types';
import { HoldbackReleaseType, HoldbackStatus, InsufficientInventoryError, InvalidReleaseQuantityError } from '../types/holdback.types';

// ---------------------------------------------------------------------------
// Pure calculation functions — no side effects, no DB access
// ---------------------------------------------------------------------------

/**
 * Calculates how many additional tickets can still be reserved as holdbacks.
 *
 * Formula: totalQty - soldQty - existingHoldbacks
 * Clamped to 0 so it never goes negative.
 *
 * @param totalQty        Total capacity of the ticket type
 * @param soldQty         Number of tickets already sold (confirmed orders)
 * @param existingHoldbacks  Sum of quantity across all ACTIVE holdbacks
 */
export function calculateAvailableForHoldback(
  totalQty: number,
  soldQty: number,
  existingHoldbacks: number,
): number {
  return Math.max(0, totalQty - soldQty - existingHoldbacks);
}

/**
 * Calculates the ticket count visible to the public (effective available).
 *
 * The public sees: totalQty - soldQty - activeHoldbacks
 * This matches remaining_qty stored in catalog.ticket_types after holdbacks
 * are subtracted at creation time.
 *
 * @param totalQty       Total capacity
 * @param soldQty        Confirmed sold tickets
 * @param activeHoldbacks  Sum of (quantity - quantity_released) for active holdbacks
 */
export function calculateEffectiveAvailable(
  totalQty: number,
  soldQty: number,
  activeHoldbacks: number,
): number {
  return Math.max(0, totalQty - soldQty - activeHoldbacks);
}

/**
 * Determines whether a holdback should be released automatically.
 *
 * Rules:
 * - Only ACTIVE holdbacks can be auto-released.
 * - MANUAL holdbacks never auto-release.
 * - SCHEDULED: release when now >= releaseAt.
 * - TRIGGER: release when currentSoldPct >= releaseTriggerPct.
 *
 * @param holdback         The holdback to evaluate
 * @param currentSoldPct   Current sell-through rate as a percentage (0–100)
 * @param now              Current timestamp
 */
export function shouldAutoRelease(
  holdback: InventoryHoldback,
  currentSoldPct: number,
  now: Date,
): boolean {
  if (holdback.status !== HoldbackStatus.Active) {
    return false;
  }

  if (holdback.releaseType === HoldbackReleaseType.Manual) {
    return false;
  }

  if (holdback.releaseType === HoldbackReleaseType.Scheduled) {
    if (holdback.releaseAt === null) {
      return false;
    }
    return now >= holdback.releaseAt;
  }

  if (holdback.releaseType === HoldbackReleaseType.Trigger) {
    if (holdback.releaseTriggerPct === null) {
      return false;
    }
    return currentSoldPct >= holdback.releaseTriggerPct;
  }

  return false;
}

/**
 * Validates that the requested holdback quantity is within available inventory.
 * Throws InsufficientInventoryError if the check fails.
 *
 * @param requested  Desired holdback quantity
 * @param available  Current available inventory (from calculateAvailableForHoldback)
 */
export function validateHoldbackQuantity(
  requested: number,
  available: number,
): void {
  if (requested > available) {
    throw new InsufficientInventoryError(requested, available);
  }
}

/**
 * Calculates the actual quantity to release in a (potentially partial) release.
 *
 * The release is capped at the number of tickets still held (not yet released).
 * If requestedRelease is 0 or less, the full remaining quantity is released.
 *
 * @param holdback          The holdback being released
 * @param requestedRelease  How many tickets to release (0 = full release)
 */
export function calculateReleasedQty(
  holdback: InventoryHoldback,
  requestedRelease: number,
): number {
  const stillHeld = holdback.quantity - holdback.quantityReleased;

  if (requestedRelease <= 0) {
    // Full release
    return stillHeld;
  }

  if (requestedRelease > stillHeld) {
    throw new InvalidReleaseQuantityError(requestedRelease, stillHeld);
  }

  return requestedRelease;
}

/**
 * Calculates the sell-through percentage for a ticket type.
 * Used by trigger-based holdbacks and processScheduledReleases.
 *
 * @param totalQty   Total capacity (including all holdbacks)
 * @param soldQty    Number of confirmed sold tickets
 */
export function calculateSellThroughPct(
  totalQty: number,
  soldQty: number,
): number {
  if (totalQty <= 0) return 0;
  return (soldQty / totalQty) * 100;
}

/**
 * Validates that a holdback percentage does not exceed the sanity cap.
 * Promoters should never hold back more than 50% of inventory.
 *
 * Throws an error if pct > 50.
 *
 * @param pct  Holdback percentage (0–100)
 */
export function validateHoldbackPercentage(pct: number): void {
  const MAX_HOLDBACK_PCT = 50;
  if (pct > MAX_HOLDBACK_PCT) {
    throw new Error(
      `Holdback percentage ${pct}% exceeds maximum allowed ${MAX_HOLDBACK_PCT}%. ` +
        'Promoters cannot reserve more than 50% of inventory.',
    );
  }
}
