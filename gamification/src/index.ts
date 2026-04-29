// gamification/src/index.ts — Public API exports

// Types
export * from './lib/types';

// Service
export {
  defineBadges,
  checkAndAwardBadges,
  recordBadgeEarned,
  getBadgesForUser,
  getGameificationStats,
  getBadgesUpcoming,
  checkStreakStatus,
} from './services/badge.service';

// Webhook
export { handleOrderCompleted, orderCompletedHandler } from './webhook/order-completed';
