// gamification/src/webhook/order-completed.ts — Order completion webhook
// Triggers badge checking when user completes a purchase.
// Integrates with the order-completed event from main webhooks system.

import { getDatabase } from '@tixly/rls-multitenancy';
import { checkAndAwardBadges } from '../services/badge.service';

/**
 * Handler for order.completed webhook event.
 * Called when user completes a purchase.
 *
 * Checks all badge criteria and awards new badges if user qualifies.
 * Idempotent: calling multiple times for same order is safe.
 */
export async function handleOrderCompleted(
  orderId: string,
  userId: string,
): Promise<void> {
  try {
    const db = getDatabase();

    // Check and award badges for this user
    const awarded = await checkAndAwardBadges(userId, db);

    if (awarded.length > 0) {
      console.log(`User ${userId} earned ${awarded.length} new badge(s):`, awarded.map((b) => b.badgeType));

      // TODO: Send notification to user about new badges
      // e.g., via email, push notification, or in-app notification
    }
  } catch (error) {
    console.error(`Failed to check badges for user ${userId}:`, error);
    // Don't throw - webhook should not fail due to gamification
    // Log for monitoring but continue
  }
}

/**
 * Export webhook handler function for integration with webhook system.
 */
export const orderCompletedHandler = handleOrderCompleted;
