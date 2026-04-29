# Implementation Summary: Task #221 Gamification — Achievements and Badges

## Overview

Complete implementation of gamification system enabling users to earn badges for milestones like their first ticket, attending events, and referrals. This increases engagement and encourages repeat purchases, following GoOut's gamification USP.

## What Was Implemented

### 1. Core Types System (`gamification/src/lib/types.ts`)

- **BadgeType enum**: 7 badge types with Czech labels
  - `first_ticket` - First ticket purchase
  - `ten_events` - Attended 10 distinct events
  - `hundred_tickets` - Purchased 100+ tickets
  - `super_fan` - Purchased 50+ tickets (higher tier)
  - `early_bird` - Bought ticket 30+ days before event
  - `friend_referrer` - Referred 3+ friends who made purchase
  - `streak_attendee` - Attended event every month for 6+ months

- **BadgeDefinition**: Static badge metadata with icons, colors, tier levels, and criteria
- **Badge**: User-facing badge instance with earned timestamps
- **Achievement**: Audit trail record in database
- **GameificationStats**: Aggregated user metrics for dashboards
- **BadgeProgress**: Progress tracking toward next unlocks
- Custom error classes for badge-specific error handling

### 2. Badge Service (`gamification/src/services/badge.service.ts`)

**Core Functions:**

- **defineBadges()**: Static definitions for all 7 badge types with unlock criteria
  - Each badge has name, description, icon, display color, tier level
  - Includes hint text for users on progress toward unlock

- **checkAndAwardBadges(userId, db)**: Check all badge criteria and award new ones
  - Idempotent: safe to call multiple times
  - Batch checking in one transaction
  - Returns array of newly awarded badges

- **recordBadgeEarned(userId, badgeType, db)**: Record achievement with UNIQUE constraint
  - Prevents duplicate awards via database constraint
  - Throws BadgeAlreadyEarnedError if already earned
  - Creates audit trail entry

- **getBadgesForUser(userId, db)**: Fetch all earned badges with metadata
  - Only returns earned badges (privacy-respecting)
  - Sorted by earned date (most recent first)

- **getGameificationStats(userId, db)**: Complete user statistics
  - ticketsCount, eventsCount, referralsCount
  - consecutiveMonths streak and lastEventDate
  - All earned badges with full metadata
  - nextBadgeEarning hint showing progress to next unlock
  - percentComplete for progress bars (0-100%)

- **getBadgesUpcoming(userId, db)**: Badges user is close to earning
  - Returns sorted by percentComplete descending
  - Format: {badgeType, name, progress, needed, percentComplete, displayColor}

- **checkStreakStatus(userId, db)**: Calculate consecutive months attended
  - Analyzes event attendance chronologically
  - Counts unbroken monthly sequence

**Badge Criteria Checkers:**

Individual functions for each badge type:
- `checkFirstTicket()`: count=1
- `checkTenEvents()`: COUNT(DISTINCT event_id) >= 10
- `checkHundredTickets()`: total tickets >= 100
- `checkSuperFan()`: total tickets >= 50
- `checkEarlyBird()`: order date <= (event_date - 30 days)
- `checkFriendReferrer()`: referred users with converted=true >= 3
- `checkStreakAttendee()`: consecutive_months >= 6

### 3. API Endpoints

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
Returns only earned badges with earnedAt timestamps:
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
Complete gamification dashboard data:
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
Badges user is close to earning:
```json
[
  {
    "badgeType": "super_fan",
    "name": "Super fanoušek",
    "progress": 45,
    "needed": 50,
    "percentComplete": 90,
    "displayColor": "#EF4444"
  }
]
```

### 4. Webhook Integration (`gamification/src/webhook/order-completed.ts`)

- **handleOrderCompleted(orderId, userId)**: Webhook handler for order completion
  - Triggers badge checking automatically
  - Non-blocking: logs errors but doesn't fail webhook
  - Calls checkAndAwardBadges internally
  - Ready to send notifications when badges earned (TODO)

### 5. Database Schema (`migrations/238_gamification.sql`)

**achievements table:**
- `id` (uuid) - Primary key
- `user_id` (uuid) - Foreign key to auth.users
- `badge_type` (text) - Badge identifier
- `earned_at` (timestamp) - When badge was earned
- `display_name` (text) - For UI display
- UNIQUE(user_id, badge_type) - Prevents duplicates
- Indexes on user_id, badge_type, earned_at

**badge_definitions table:**
- `id` (text) - Primary key
- `badge_type` (text) - Unique badge identifier
- `name` (text) - Badge name
- `description` (text) - User-facing description
- `icon_url` (text) - Icon reference
- `display_color` (text) - Color for UI
- `criteria_json` (jsonb) - Unlock criteria
- `tier` (text) - bronze/silver/gold/platinum

### 6. Testing (`gamification/src/__tests__/badge.service.test.ts`)

Comprehensive test suite with 30+ test cases covering:

**Badge Definitions:**
- 7 badge types defined with all required fields
- Unique badge types and tier hierarchy

**Achievement Recording:**
- Record new achievements
- Prevent duplicate awards via UNIQUE constraint
- Error handling for invalid badge types

**Badge Retrieval:**
- Empty array for new users
- Earned badges with full metadata
- Sorted by earned date

**Award Checking:**
- first_ticket: counts >= 1
- ten_events: distinct events >= 10
- hundred_tickets: total tickets >= 100
- super_fan: tickets >= 50
- early_bird: order date 30+ days before event
- friend_referrer: referred users >= 3
- streak_attendee: consecutive months >= 6
- Idempotence: calling multiple times awards only once

**Statistics:**
- Ticket and event aggregation
- Next badge hint calculation
- Streak calculation
- Upcoming badges sorting

### 7. Project Structure

```
gamification/
├── src/
│   ├── lib/
│   │   └── types.ts                 # Type definitions
│   ├── services/
│   │   ├── badge.service.ts         # Core service logic
│   │   └── index.ts                 # Service exports
│   ├── app/api/
│   │   ├── badges/
│   │   │   └── route.ts             # GET all badge definitions
│   │   └── users/[userId]/
│   │       ├── badges/
│   │       │   ├── route.ts         # GET user badges
│   │       │   └── upcoming/
│   │       │       └── route.ts     # GET upcoming badges
│   │       └── stats/
│   │           └── route.ts         # GET user stats
│   ├── webhook/
│   │   └── order-completed.ts       # Webhook handler
│   ├── __tests__/
│   │   └── badge.service.test.ts    # Service tests
│   └── index.ts                     # Public exports
├── examples/
│   └── webhook-integration.ts       # Integration examples
├── INTEGRATION.md                   # Integration guide
├── package.json                     # Dependencies
├── tsconfig.json                    # TypeScript config
└── vitest.config.ts                # Test config

migrations/
└── 238_gamification.sql             # Database schema
```

## Key Design Decisions

### 1. Idempotency
- UNIQUE(user_id, badge_type) constraint prevents duplicate awards
- checkAndAwardBadges() can be called multiple times safely
- Perfect for webhook retry scenarios

### 2. Batch Checking
- All 7 badge criteria evaluated in single transaction
- Single DB call per badge type
- Efficient and avoids N+1 queries

### 3. Privacy
- Only earned badges returned by getBadgesForUser()
- Locked badges not exposed (privacy-respecting)
- Admin can see all via badge_definitions table

### 4. Performance
- Static badge definitions cached on client
- Badge criteria queries are indexed
- Streak calculation optimized with DATE_TRUNC

### 5. Extensibility
- Each badge type has dedicated criteria function
- Easy to add new badges in defineBadges()
- Badge definitions include hints for future UI features

## Data Flows

### Earning a Badge

1. User completes purchase → order.completed webhook fires
2. handleOrderCompleted(orderId, userId) is called
3. checkAndAwardBadges(userId, db) runs:
   - Checks all 7 badge criteria for user
   - For each criteria met, calls recordBadgeEarned()
   - recordBadgeEarned() INSERTs with ON CONFLICT DO NOTHING
4. Returns array of newly awarded badges
5. (TODO) Send notification to user about new badges

### Viewing Progress

1. Frontend requests `/api/users/:userId/stats`
2. getGameificationStats() queries:
   - Total tickets, events, referrals
   - Consecutive months streak
   - All earned achievements
   - Calculates nextBadgeEarning hint
3. Returns complete stats object
4. Frontend displays badges and progress bars

### Future Notifications

```typescript
// TODO: Send email when badge earned
async function notifyBadgeEarned(userId, badge) {
  await sendEmail({
    to: user.email,
    template: 'badge-earned',
    data: {
      badgeName: badge.name,
      badgeIcon: badge.icon,
      badgeDescription: badge.description,
    }
  });
}

// TODO: Send push notification
async function notifyBadgeEarned(userId, badge) {
  await pushNotification.send(userId, {
    title: `Earned: ${badge.name}`,
    body: badge.description,
    icon: badge.icon,
  });
}
```

## Integration Checklist

- [x] Database migration created (238_gamification.sql)
- [x] Type definitions complete with 7 badge types
- [x] Badge service with all criteria checkers
- [x] Idempotent award logic with UNIQUE constraint
- [x] 4 API endpoints for badges and stats
- [x] Webhook handler for order.completed
- [x] Comprehensive tests (30+ test cases)
- [x] Integration documentation
- [ ] Add to main webhooks dispatcher (order.completed)
- [ ] Run database migration in production
- [ ] Deploy gamification module
- [ ] Add email notifications for badge earnings (optional)
- [ ] Add push notifications for badge progress (optional)
- [ ] Create leaderboards by badge count (optional)

## Files Created

### Core Implementation
- `/gamification/src/lib/types.ts` - Type definitions (100 lines)
- `/gamification/src/services/badge.service.ts` - Service implementation (600+ lines)
- `/gamification/src/index.ts` - Public exports
- `/gamification/src/services/index.ts` - Service exports

### API Routes
- `/gamification/src/app/api/badges/route.ts`
- `/gamification/src/app/api/users/[userId]/badges/route.ts`
- `/gamification/src/app/api/users/[userId]/stats/route.ts`
- `/gamification/src/app/api/users/[userId]/badges/upcoming/route.ts`

### Webhook & Integration
- `/gamification/src/webhook/order-completed.ts`
- `/gamification/examples/webhook-integration.ts`

### Testing & Config
- `/gamification/src/__tests__/badge.service.test.ts` (500+ lines)
- `/gamification/package.json`
- `/gamification/tsconfig.json`
- `/gamification/vitest.config.ts`

### Documentation & Database
- `/gamification/INTEGRATION.md` (Comprehensive integration guide)
- `/migrations/238_gamification.sql` (Database schema)

## Testing Results

All test scenarios pass:
- 7 badge definitions with proper structure
- UNIQUE constraint prevents duplicates
- All 7 badge criteria checkers implemented
- Idempotence verified
- Stats aggregation accurate
- Streak calculation correct
- Upcoming badges sorted properly

## Performance Notes

- **Database Queries**: 
  - Achievement lookup: O(1) with index on user_id
  - Streak calculation: O(n) where n = number of events user attended
  - Badge checking: 7 queries total in batch, not 7 individual

- **Memory**: Minimal - badge definitions are static and small
- **Latency**: Webhook handler is async, doesn't block order completion

## Maintenance & Monitoring

Monitor these metrics:
- Badge earning rates by type (are incentives working?)
- User engagement increase after badge system launch
- Time to next badge unlock (predict retention)
- Referral conversion rates for friend_referrer badge
- Streak length distribution (loyalty indicator)

## Next Steps for Integration

1. **Add to webhooks dispatcher**:
   ```typescript
   if (event.type === 'order.completed') {
     await handleOrderCompleted(event.payload.orderId, event.payload.userId)
       .catch(err => console.error('Gamification failed:', err));
   }
   ```

2. **Run migration**:
   ```sql
   psql -f migrations/238_gamification.sql
   ```

3. **Deploy module**:
   - Add to package.json dependencies
   - Build and deploy

4. **Monitor in production**:
   - Track badge earning events
   - Monitor API endpoint latency
   - Check for duplicate achievement attempts

5. **Optional enhancements**:
   - Email notifications for badge earnings
   - Push notifications for progress milestones
   - Leaderboards and achievements page
   - Seasonal badges for special events

## Pattern Consistency

This implementation follows existing patterns:
- **Injectable DbAdapter** like loyalty-points and affiliate-tracking
- **Service-based architecture** with defined responsibilities
- **Type-safe operations** with TypeScript strict mode
- **Webhook integration** similar to other modules
- **Database constraints** for data integrity (UNIQUE constraint)
- **Idempotent operations** safe for retries
- **Comprehensive testing** with vitest
- **Privacy-first** (only earned badges exposed via API)

