# @tixly/purchase-limit

Purchase limit enforcement library for Tixly — **Feature #54**.

Enforces a maximum number of tickets (default: 4) per verified account per event.

## Usage

```typescript
import { enforcePurchaseLimit, PurchaseLimitDb } from '@tixly/purchase-limit';

// Before creating an order, call:
await enforcePurchaseLimit(
  userId,
  eventId,
  requestedQuantity,
  db, // implements PurchaseLimitDb
  config // optional, defaults to { maxTicketsPerUser: 4, verifiedOnly: true }
);
// If limit is exceeded, throws PurchaseLimitExceededError (409)
```

## Integration Points

Add the enforcement call **BEFORE** order insertion in:
1. **stripe-payments** — checkout route (`/api/payments/stripe/checkout`)
2. **b2b-api** — order creation endpoint (`/api/v1/orders`)
3. **buyer-portal** — order creation flow (if exists)

Example wire-up:
```typescript
// In order creation handler, BEFORE db.execute(INSERT orders):
import { enforcePurchaseLimit } from '@tixly/purchase-limit';

// Feature #54: enforce per-event purchase limit
await enforcePurchaseLimit(userId, eventId, totalQuantity, dbAdapter, {
  maxTicketsPerUser: 4,
  verifiedOnly: true,
});
```

## Database Adapter

Implement `PurchaseLimitDb`:
- `countUserTicketsForEvent(userId, eventId)` — sum tickets across paid + pending orders
- `isUserVerified(userId)` — check `email_verified` flag in users table

## Testing

```bash
npm test
```

Covers:
- ✅ Verified user under limit
- ✅ Verified user exceeding limit
- ✅ Verified user at exact limit
- ✅ Unverified user with `verifiedOnly=true` (skipped)
- ✅ Unverified user with `verifiedOnly=false` (enforced)
- ✅ Custom config
