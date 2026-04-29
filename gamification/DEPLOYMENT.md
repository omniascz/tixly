# Gamification Module — Deployment Checklist

## Pre-Deployment

- [x] All code written and tested
- [x] Database migration created (238_gamification.sql)
- [x] API endpoints implemented
- [x] Webhook handler ready
- [x] Tests passing (30+ test cases)
- [x] Documentation complete
- [x] TypeScript strict mode enabled

## Deployment Steps

### 1. Run Database Migration

```bash
# Development
psql -U user -d tixly_dev -f migrations/238_gamification.sql

# Staging
psql -U user -d tixly_staging -f migrations/238_gamification.sql

# Production (with backup first!)
pg_dump tixly_prod > backup_$(date +%Y%m%d).sql
psql -U user -d tixly_prod -f migrations/238_gamification.sql
```

Verify tables created:
```sql
SELECT table_name FROM information_schema.tables WHERE table_schema = 'gamification';
```

Expected output:
```
 table_name
─────────────────────
 achievements
 badge_definitions
```

### 2. Deploy Gamification Module

```bash
# Option A: Monorepo
npm install
npm run build

# Option B: Standalone package
npm publish

# Option C: Docker
docker build -f Dockerfile -t gamification:v1 .
docker push your-registry/gamification:v1
```

### 3. Add Webhook Integration

Edit your webhooks dispatcher (likely in `webhooks/src/services/dispatcher.service.ts`):

```typescript
import { handleOrderCompleted } from 'gamification';

export async function dispatchWebhook(event) {
  if (event.type === 'order.completed') {
    const { orderId, userId } = event.payload;

    // Don't await - fire and forget
    handleOrderCompleted(orderId, userId).catch(err => {
      console.error('Gamification check failed:', err);
      // Log to error tracking (Sentry, etc)
    });

    // Continue with other handlers...
  }
}
```

### 4. Verify API Endpoints

After deployment, test each endpoint:

```bash
# 1. Get all badge definitions
curl http://localhost:3000/api/badges | jq '.[0]'

# Expected: Badge definition with name, description, tier, criteria

# 2. Get user badges (use a real user ID)
curl http://localhost:3000/api/users/{userId}/badges | jq '.'

# Expected: [] or array of earned badges

# 3. Get user stats
curl http://localhost:3000/api/users/{userId}/stats | jq '.badgesCount'

# Expected: 0 initially, increases as user earns badges

# 4. Get upcoming badges
curl http://localhost:3000/api/users/{userId}/badges/upcoming | jq '.'

# Expected: Array of badges sorted by percentComplete
```

### 5. Monitor Badge Earning

In your analytics/monitoring:

```sql
-- Check badge earning activity
SELECT badge_type, COUNT(*) as count, COUNT(DISTINCT user_id) as users
FROM gamification.achievements
WHERE earned_at > NOW() - interval '24 hours'
GROUP BY badge_type
ORDER BY count DESC;

-- Check for any errors in logs
SELECT * FROM logs WHERE service = 'gamification' AND level = 'ERROR'
ORDER BY created_at DESC;

-- Verify no duplicate achievements
SELECT user_id, badge_type, COUNT(*)
FROM gamification.achievements
GROUP BY user_id, badge_type
HAVING COUNT(*) > 1;

-- Should return no results (UNIQUE constraint prevents this)
```

## Post-Deployment Monitoring

### First 24 Hours

1. **Monitor error rates**
   - Should be 0 errors in gamification service
   - Watch logs for any "Failed to check badges" errors

2. **Verify badge awards**
   - Check if users are earning badges on purchases
   - Verify webhook handler is being called
   - Monitor database query latency

3. **API response times**
   - /api/badges should be <100ms (cached)
   - /api/users/{userId}/stats should be <500ms
   - /api/users/{userId}/badges/upcoming should be <500ms

### Daily Monitoring

```sql
-- Daily badge earning metrics
SELECT
  DATE(earned_at) as date,
  badge_type,
  COUNT(*) as awards,
  COUNT(DISTINCT user_id) as unique_users
FROM gamification.achievements
GROUP BY DATE(earned_at), badge_type
ORDER BY date DESC, awards DESC;

-- Check if badges are being earned
SELECT COUNT(*) as total_achievements FROM gamification.achievements;

-- Identify power users (most badges)
SELECT user_id, COUNT(*) as badges
FROM gamification.achievements
GROUP BY user_id
ORDER BY badges DESC
LIMIT 10;
```

### Weekly Metrics

- Total badges awarded
- Most popular badge type
- Average badges per user
- Badge earning velocity (badges/week)
- Correlation between badges and repeat purchases

## Rollback Plan

If issues occur:

### Immediate Rollback (first 24 hours)

1. **Disable webhook handler**:
   ```typescript
   // Comment out or wrap with feature flag
   // await handleOrderCompleted(orderId, userId).catch(err => ...);
   ```

2. **Disable API endpoints** (return 503 Service Unavailable):
   ```typescript
   export async function GET(request) {
     return NextResponse.json(
       { error: 'Service temporarily unavailable' },
       { status: 503 }
     );
   }
   ```

3. **Keep database schema** (non-destructive):
   ```sql
   -- Data is preserved, just disable the feature
   ```

### Full Rollback (if needed)

```bash
# Restore from backup
psql -U user -d tixly_prod < backup_$(date +%Y%m%d).sql

# Revert code changes
git revert {commit-hash}

# Redeploy without gamification
npm run build
docker push ...
```

**Risk Level**: Low
- Gamification is independent module
- Database changes are additive only
- Webhook handler is async and non-blocking
- Rollback won't affect existing orders or users

## Success Criteria

- [x] All tests passing locally
- [ ] Database migration applies without errors
- [ ] 4 API endpoints responding correctly
- [ ] Webhook handler receiving order.completed events
- [ ] Badges awarded after order completion
- [ ] No duplicate achievements in database
- [ ] Error rates < 0.1%
- [ ] API latency < 500ms
- [ ] Users seeing earned badges in frontend
- [ ] Zero impact on order completion flow

## Maintenance

### Regular Tasks

1. **Monitor badge earning patterns**
   - Are badges evenly distributed?
   - Are any badges never earned?
   - Are some too easy/hard?

2. **Check database health**
   - No long-running queries
   - Index efficiency (use EXPLAIN ANALYZE)
   - No table bloat (ANALYZE gamification.achievements)

3. **Review logs weekly**
   - Look for patterns in errors
   - Check for performance degradation
   - Verify webhook integration working

### Optimization

If latency increases:

```sql
-- Analyze query performance
EXPLAIN ANALYZE
SELECT COUNT(DISTINCT ot.event_id) as events_count
FROM orders.orders o
JOIN orders.order_tickets ot ON o.id = ot.order_id
WHERE o.user_id = 'user_123' AND o.status = 'completed';

-- Add missing indexes if needed
CREATE INDEX idx_order_tickets_user_id_status
ON orders.orders(user_id) WHERE status = 'completed';
```

## Support Contacts

- **Database Issues**: DBA team
- **Webhook Issues**: Platform team
- **API Issues**: Backend team
- **Frontend Issues**: Frontend team
- **Questions**: See INTEGRATION.md and QUICKSTART.md

