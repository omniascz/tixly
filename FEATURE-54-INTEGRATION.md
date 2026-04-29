# Feature #54 — Purchase Limit Enforcement Integration Guide

**Status**: Implementation complete. Enforcement logic ready. Awaiting integration into order creation endpoints.

## Overview

Feature #54 enforces a **maximum of 4 tickets per verified user per event**. The logic is implemented in a new shared library `@tixly/purchase-limit`.

## Implementation Location

**Helper module**: `C:\Users\omnia\Documents\tixly\shared\purchase-limit\`

### Files
- `src/purchase-limit.ts` — Core enforcement logic
- `src/index.ts` — Public exports
- `src/purchase-limit.test.ts` — 8 unit tests covering all scenarios
- `package.json`, `tsconfig.json`, `vitest.config.ts` — Build config

## Integration Steps

### 1. Stripe Payments Module
**File**: `C:\Users\omnia\Documents\tixly\stripe-payments\src\app\api\payments\stripe\checkout\route.ts`

**Add to POST handler BEFORE PaymentIntent creation** (around line 71):

```typescript
import { enforcePurchaseLimit } from '@tixly/purchase-limit';

// ... existing code ...

try {
  // Feature #54: enforce per-event purchase limit
  await enforcePurchaseLimit(
    userId,
    order.event_id,
    order.total_quantity, // sum of all items' quantities
    dbAdapter,
    { maxTicketsPerUser: 4, verifiedOnly: true }
  );

  const result = await createPaymentIntent(
    {
      orderId,
      amountHellers: order.amount_hellers,
      currency: order.currency ?? 'czk',
      metadata: { userId: _userId },
    },
    deps,
  );
  // ...
}
```

### 2. B2B API Module
**File**: `C:\Users\omnia\Documents\tixly\b2b-api\src\app\api\v1\orders\route.ts`

**Add to POST handler BEFORE db.createOrder()** (around line 92):

```typescript
import { enforcePurchaseLimit } from '@tixly/purchase-limit';

// ... existing code ...

const availabilityCheck = await db.checkAvailability(items);
if (!available) { /* ... error ... */ }

// Feature #54: enforce per-event purchase limit
const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
try {
  await enforcePurchaseLimit(
    auth.promoterId, // or extract actual buyer userId from context
    body.event_id as string,
    totalQuantity,
    db,
    { maxTicketsPerUser: 4, verifiedOnly: true }
  );
} catch (err) {
  if (err instanceof PurchaseLimitExceededError) {
    return errorResponse(409, 'PURCHASE_LIMIT_EXCEEDED', err.message, auth.requestId);
  }
  throw err;
}

const created = await db.createOrder({ /* ... */ });
```

### 3. Buyer Portal (if order creation flow exists)
**File**: Look for POST endpoint in `/api/portal/` that creates orders.

Same pattern as above — call `enforcePurchaseLimit` before order insertion.

## Error Response

When limit is exceeded:
```json
{
  "code": "PURCHASE_LIMIT_EXCEEDED",
  "statusCode": 409,
  "message": "Překročen limit 4 vstupenek na akci. Aktuálně máte 2, pokoušíte se přidat 3."
}
```

## Database Adapter Implementation

The module expects implementations of:

```typescript
interface PurchaseLimitDb {
  countUserTicketsForEvent(userId: string, eventId: string): Promise<number>;
  isUserVerified(userId: string): Promise<boolean>;
}
```

**Typical SQL**:
```sql
-- Count tickets for user/event
SELECT COUNT(*) as count FROM order_items oi
JOIN orders.orders o ON o.id = oi.order_id
WHERE o.user_id = $1 AND o.event_id = $2 AND o.status IN ('paid', 'pending');

-- Check user verification
SELECT email_verified FROM identity.users WHERE id = $1;
```

## Testing

```bash
cd C:\Users\omnia\Documents\tixly\shared\purchase-limit
npm test
```

**Test scenarios** (8 total):
1. ✅ Verified user under limit → passes
2. ✅ Verified user exceeds limit → throws 409
3. ✅ Verified user at exact limit → passes
4. ✅ Unverified user with `verifiedOnly=true` → skipped (passes)
5. ✅ Unverified user with `verifiedOnly=false` → enforced
6. ✅ Default config usage
7. ✅ Custom `maxTicketsPerUser` respected
8. ✅ Error properties correct

## Exports

From `@tixly/purchase-limit`:
- `enforcePurchaseLimit(userId, eventId, requestedQuantity, db, config?)` — Main function
- `PurchaseLimitExceededError` — Exception class
- `DEFAULT_PURCHASE_LIMIT` — Config const
- `type PurchaseLimitConfig` — TS interface
- `type PurchaseLimitDb` — TS interface

## Notes

- **No database changes** — uses existing `orders` and `identity.users` tables
- **Idempotent** — safe to call multiple times before order creation
- **Verified-only by default** — unverified accounts exempt (may have other limits)
- **Configurable** — limit can be changed via config object
