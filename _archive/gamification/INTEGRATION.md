# Gamification Module Integration Guide

## Overview

The gamification module provides a badge and achievement system for Tixly. Users earn badges for milestones like purchasing their first ticket, attending multiple events, or referrals. This increases engagement and encourages repeat purchases.

## Badge Types

7 badge types are defined with automatic criteria checking:

1. **first_ticket** (bronze): User purchases first ticket
2. **ten_events** (silver): User attends 10 distinct events
3. **hundred_tickets** (gold): User purchases 100+ tickets
4. **super_fan** (platinum): User purchases 50+ tickets (higher tier)
5. **early_bird** (silver): User buys ticket 30+ days before event
6. **friend_referrer** (gold): User refers 3+ friends who made purchase
7. **streak_attendee** (platinum): User attends event every month for 6+ months

## Database Setup

Run migration `238_gamification.sql` to create required tables:

- `gamification.achievements` - User achievement records with UNIQUE(user_id, badge_type)
- `gamification.badge_definitions` - Static badge definitions

## Integration Points

### 1. Webhook Integration

Hook into `order.completed` webhook event to trigger badge checking:

```typescript
import { handleOrderCompleted } from 'gamification';

// In your webhook dispatcher
if (event.type === 'order.completed') {
  await handleOrderCompleted(event.orderId, event.userId);
}
```

The handler:
- Checks all badge criteria for the user
- Awards new badges if criteria met
- Prevents duplicates via UNIQUE constraint
- Logs for monitoring but doesn't fail the webhook

### 2. API Endpoints

#### GET /api/badges
Returns all badge definitions with unlock criteria:
```json
[
  {
    "id": "badge_first_ticket",
    "badgeType": "first_ticket",
    "name": "První vstupenka",
    "description": "Koupil jsi si svou první vstupenku na Tixly!",
    "icon": "ticket-primary",
    "displayColor": "#4F46E5",
    "tier": "bronze",
    "criteria": {
      "type": "count",
      "threshold": 1,
      "hint": "Kup si první vstupenku"
    }
  }
]
```

#### GET /api/users/:userId/badges
Returns user's earned badges:
```json
[
  {
    "id": "badge_first_ticket",
    "badgeType": "first_ticket",
    "name": "První vstupenka",
    "icon": "ticket-primary",
    "displayColor": "#4F46E5",
    "earnedAt": "2025-04-18T10:30:00Z"
  }
]
```

#### GET /api/users/:userId/stats
Returns complete gamification stats:
```json
{
  "userId": "user_123",
  "ticketsCount": 45,
  "eventsCount": 8,
  "referralsCount": 2,
  "consecutiveMonths": 3,
  "lastEventDate": "2025-04-15T19:00:00Z",
  "badgesCount": 2,
  "badges": [...],
  "nextBadgeEarning": {
    "badgeType": "super_fan",
    "progress": 45,
    "needed": 50,
    "percentComplete": 90
  }
}
```

#### GET /api/users/:userId/badges/upcoming
Returns badges user is close to earning with progress:
```json
[
  {
    "badgeType": "super_fan",
    "name": "Super fanoušek",
    "progress": 45,
    "needed": 50,
    "percentComplete": 90,
    "displayColor": "#EF4444"
  },
  {
    "badgeType": "ten_events",
    "name": "Desátkrát",
    "progress": 8,
    "needed": 10,
    "percentComplete": 80,
    "displayColor": "#F59E0B"
  }
]
```

## Service Functions

### checkAndAwardBadges(userId, db)

Checks all badge criteria and awards new ones. Idempotent:

```typescript
import { checkAndAwardBadges } from 'gamification';

const awarded = await checkAndAwardBadges(userId, db);
// Returns: Badge[] of newly awarded badges
```

### recordBadgeEarned(userId, badgeType, db)

Records a single achievement. Throws `BadgeAlreadyEarnedError` if already earned:

```typescript
import { recordBadgeEarned } from 'gamification';

const achievement = await recordBadgeEarned(userId, 'first_ticket', db);
```

### getBadgesForUser(userId, db)

Gets all earned badges with metadata:

```typescript
import { getBadgesForUser } from 'gamification';

const badges = await getBadgesForUser(userId, db);
// Returns: Badge[] with earnedAt timestamps
```

### getGameificationStats(userId, db)

Gets complete user stats including badges, counts, and next milestone:

```typescript
import { getGameificationStats } from 'gamification';

const stats = await getGameificationStats(userId, db);
// Returns: GameificationStats with all metrics
```

### getBadgesUpcoming(userId, db)

Gets badges user is close to earning:

```typescript
import { getBadgesUpcoming } from 'gamification';

const upcoming = await getBadgesUpcoming(userId, db);
// Returns: BadgeProgress[] sorted by percentComplete descending
```

### checkStreakStatus(userId, db)

Calculates consecutive months attended:

```typescript
import { checkStreakStatus } from 'gamification';

const streak = await checkStreakStatus(userId, db);
// Returns: number of consecutive months
```

## Data Models

### Badge
```typescript
interface Badge {
  id: string;
  badgeType: BadgeType;
  name: string;
  description: string;
  icon: string;
  displayColor: string;
  earnedAt?: Date;
}
```

### GameificationStats
```typescript
interface GameificationStats {
  userId: string;
  ticketsCount: number;
  eventsCount: number;
  referralsCount: number;
  consecutiveMonths: number;
  lastEventDate?: Date;
  badges: Badge[];
  badgesCount: number;
  nextBadgeEarning?: {
    badgeType: BadgeType;
    progress: number;
    needed: number;
    percentComplete: number;
  };
}
```

## Performance Considerations

1. **Idempotency**: The UNIQUE(user_id, badge_type) constraint on achievements table ensures no duplicate awards. Safe to call `checkAndAwardBadges` multiple times.

2. **Batch Checking**: All badge criteria are evaluated in one transaction, avoiding N+1 queries.

3. **Webhook Integration**: Badge checking is async and doesn't block order completion. Errors are logged but don't fail the webhook.

4. **Caching**: Badge definitions are static and can be cached on the client side.

## Testing

Run tests with:
```bash
npm test
```

Tests cover:
- Badge definition validation (7+ types)
- Achievement recording with duplicate prevention
- All badge criteria checkers
- Gamification statistics aggregation
- Streak calculation
- Idempotence of badge awarding

## Frontend Integration

1. Display badge definitions from `/api/badges`
2. Show earned badges from `/api/users/:userId/badges`
3. Display gamification stats from `/api/users/:userId/stats`
4. Show progress to next badge from `/api/users/:userId/badges/upcoming`

Example React component:

```tsx
function UserBadges({ userId }: { userId: string }) {
  const [stats, setStats] = useState<GameificationStats | null>(null);

  useEffect(() => {
    fetch(`/api/users/${userId}/stats`)
      .then(r => r.json())
      .then(setStats);
  }, [userId]);

  if (!stats) return <div>Loading...</div>;

  return (
    <div>
      <h2>Badges ({stats.badgesCount})</h2>
      <div className="badges">
        {stats.badges.map(b => (
          <div key={b.id} style={{ color: b.displayColor }}>
            <img src={`/icons/${b.icon}.svg`} />
            <p>{b.name}</p>
          </div>
        ))}
      </div>

      {stats.nextBadgeEarning && (
        <div className="next-badge">
          <p>{stats.nextBadgeEarning.name}</p>
          <progress
            value={stats.nextBadgeEarning.progress}
            max={stats.nextBadgeEarning.needed}
          />
          <p>{stats.nextBadgeEarning.percentComplete}%</p>
        </div>
      )}
    </div>
  );
}
```

## Future Extensions

- **Email notifications** when badges are earned
- **Push notifications** for upcoming milestones
- **Newsletter badges** for engagement tracking
- **Leaderboards** by tier or badge count
- **Seasonal badges** for special events
- **Achievement tiers** with progression (bronze → gold)

## Related Modules

- **loyalty-points**: Points system that complements badges
- **affiliate-tracking**: Provides referral data for friend_referrer badge
- **webhooks**: Order completion events trigger badge checking
