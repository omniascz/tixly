# Gamification Module — Quick Start

## Installation

1. **Run the migration**:
```bash
psql -f migrations/238_gamification.sql
```

2. **Install the module** (if using monorepo):
```bash
npm install gamification
```

## Usage Examples

### 1. Get All Badge Definitions

```bash
curl http://localhost:3000/api/badges
```

Returns all 7 badge types with unlock criteria for your UI.

### 2. Get User's Earned Badges

```bash
curl http://localhost:3000/api/users/{userId}/badges
```

Show user's achievement wall. Only earned badges are returned.

### 3. Get User's Gamification Stats

```bash
curl http://localhost:3000/api/users/{userId}/stats
```

Get everything: ticket count, event attendance, badges, next milestone hint.

### 4. Get Badges User is Close to Earning

```bash
curl http://localhost:3000/api/users/{userId}/badges/upcoming
```

Returns badges sorted by progress % - great for progress bars.

## Webhook Integration

Add to your `order.completed` webhook handler:

```typescript
import { handleOrderCompleted } from 'gamification';

// In your webhook dispatcher:
if (event.type === 'order.completed') {
  // Don't await - just fire and forget
  handleOrderCompleted(event.orderId, event.userId).catch(err => {
    console.error('Badge check failed:', err);
  });
}
```

That's it! When user completes purchase:
1. Badge criteria are checked
2. New badges are awarded (if earned)
3. UNIQUE constraint prevents duplicates
4. Log entry created for audit trail

## The 7 Badges

| Badge | Trigger | Tier |
|-------|---------|------|
| **První vstupenka** (first_ticket) | Buy 1st ticket | Bronze |
| **Desátkrát** (ten_events) | Attend 10 different events | Silver |
| **Super fanoušek** (super_fan) | Buy 50+ tickets | Platinum |
| **Stovka** (hundred_tickets) | Buy 100+ tickets | Gold |
| **Včasný pták** (early_bird) | Buy ticket 30+ days early | Silver |
| **Kamarádem** (friend_referrer) | Refer 3+ friends who buy | Gold |
| **Věrný návštěvník** (streak_attendee) | Attend event every month for 6+ months | Platinum |

## Frontend Example

```tsx
import { useEffect, useState } from 'react';

function UserBadges({ userId }) {
  const [stats, setStats] = useState(null);
  const [upcoming, setUpcoming] = useState([]);

  useEffect(() => {
    Promise.all([
      fetch(`/api/users/${userId}/stats`).then(r => r.json()),
      fetch(`/api/users/${userId}/badges/upcoming`).then(r => r.json()),
    ]).then(([s, u]) => {
      setStats(s);
      setUpcoming(u);
    });
  }, [userId]);

  return (
    <div className="gamification">
      {/* Earned Badges */}
      <div className="earned-badges">
        <h3>Badges Earned: {stats?.badgesCount}</h3>
        <div className="badge-list">
          {stats?.badges.map(badge => (
            <div
              key={badge.id}
              className="badge"
              style={{ borderColor: badge.displayColor }}
            >
              <img src={`/icons/${badge.icon}.svg`} alt={badge.name} />
              <p>{badge.name}</p>
              <small>{new Date(badge.earnedAt).toLocaleDateString()}</small>
            </div>
          ))}
        </div>
      </div>

      {/* Next Badge Progress */}
      {stats?.nextBadgeEarning && (
        <div className="next-badge">
          <h3>Next Badge: {stats.nextBadgeEarning.badgeType}</h3>
          <progress
            value={stats.nextBadgeEarning.progress}
            max={stats.nextBadgeEarning.needed}
          />
          <p>
            {stats.nextBadgeEarning.progress} / {stats.nextBadgeEarning.needed}
            ({stats.nextBadgeEarning.percentComplete}%)
          </p>
        </div>
      )}

      {/* Upcoming Badges */}
      <div className="upcoming-badges">
        <h3>Work Towards</h3>
        {upcoming.map(badge => (
          <div key={badge.badgeType} className="upcoming-item">
            <p>{badge.name}</p>
            <progress
              value={badge.progress}
              max={badge.needed}
            />
            <small>{badge.percentComplete}% complete</small>
          </div>
        ))}
      </div>
    </div>
  );
}
```

## TypeScript Usage

```typescript
import {
  defineBadges,
  checkAndAwardBadges,
  getBadgesForUser,
  getGameificationStats,
  type GameificationStats,
  type Badge,
  type BadgeProgress,
} from 'gamification';
import { getDatabase } from '@tixly/rls-multitenancy';

// Get all badge definitions
const badges = defineBadges();
console.log(`Available badges: ${badges.length}`);

// Check and award badges after purchase
const db = getDatabase();
const awarded = await checkAndAwardBadges(userId, db);
if (awarded.length > 0) {
  console.log(`User earned ${awarded.length} badges!`);
}

// Get user stats
const stats: GameificationStats = await getGameificationStats(userId, db);
console.log(`User has ${stats.badgesCount} badges`);
console.log(`Next milestone: ${stats.nextBadgeEarning?.name}`);
console.log(`Progress: ${stats.nextBadgeEarning?.percentComplete}%`);
```

## Testing

```bash
npm test                    # Run all tests
npm test:ui                # Run with UI
npm test:coverage          # Generate coverage report
```

Tests cover all 7 badge types, idempotency, and stats calculation.

## Monitoring

Track these metrics in your analytics:
- Badge earning rates by type
- User engagement before/after earning badge
- Referral conversion (friend_referrer badge effectiveness)
- Streak length distribution (loyalty indicator)

## Troubleshooting

**Badge not awarded after purchase?**
- Check that order status = 'completed'
- Verify webhook is being called
- Check logs for errors

**Getting duplicate badges?**
- The database UNIQUE constraint prevents this
- If you see duplicates, run: `SELECT DISTINCT ON (user_id, badge_type) * FROM gamification.achievements;`

**API returning 500?**
- Check database migration ran successfully
- Verify @tixly/rls-multitenancy is installed
- Check logs for specific error

## What's Next?

1. **Email notifications**: Send email when user earns badge
2. **Push notifications**: Notify when user is close to next badge
3. **Leaderboards**: Show top badge earners
4. **Seasonal badges**: Limited-time badges for special events
5. **Badge trading**: Let users share/gift badges

See INTEGRATION.md for full API documentation.

## FAQ

**Q: Can I add my own badges?**
A: Yes! Edit `defineBadges()` in badge.service.ts and add your new badge type to the BadgeType union.

**Q: How often should I check badges?**
A: After every order.completed event. The webhook handler is idempotent, so safe to call multiple times.

**Q: Are badges lost if user refunds?**
A: No, badges are permanent. Consider adding a "refund cooldown" if needed.

**Q: Can I see all badge definitions?**
A: Yes, GET /api/badges returns all definitions. Only earned badges are returned per-user for privacy.

**Q: How do I reset badges?**
A: Delete from achievements table: `DELETE FROM gamification.achievements WHERE user_id = $1`

