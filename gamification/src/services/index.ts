// gamification/src/services/index.ts — Service exports

export {
  defineBadges,
  checkAndAwardBadges,
  recordBadgeEarned,
  getBadgesForUser,
  getGameificationStats,
  getBadgesUpcoming,
  checkStreakStatus,
} from './badge.service';

export type { BadgeServiceDeps } from './badge.service';
