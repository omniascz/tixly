# Group Payment Splitting Service

A service for managing collaborative ticket purchases where a group of friends buys tickets together and payment is automatically split among members.

## Features

- **Group Creation**: Organize tickets for an event with automatic invitation system
- **Flexible Splitting Strategies**:
  - **Equal**: Divide total cost equally among all members
  - **Proportional**: Split cost based on ticket prices (higher price = larger share)
  - **Custom**: Manual per-member amounts set by group owner
- **Invitation System**: Send email invites with expiring tokens to group members
- **Payment Tracking**: Record individual payments and track settlement status
- **Settlement Reports**: Generate balance summaries for dispute resolution

## Database Schema

### group_payments
- `id` (uuid): Primary key
- `group_owner_id` (uuid): User who created the group
- `event_id` (uuid): Event being purchased for
- `total_amount_halire` (integer): Total group cost in haléře (smallest currency unit)
- `splitter_strategy` (text): 'equal' | 'proportional' | 'custom'
- `status` (text): 'pending' | 'paid' | 'disputed'
- `created_at` (timestamp): Group creation time
- `updated_at` (timestamp): Last update time

**Indexes**: owner_id, event_id, status

### group_members
- `id` (uuid): Primary key
- `group_payment_id` (uuid): Reference to group
- `user_id` (uuid): Member user ID
- `order_id` (uuid): Member's order in the group
- `amount_owed_halire` (integer): Amount member should pay
- `amount_paid_halire` (integer): Amount member has paid
- `status` (text): 'pending' | 'paid' | 'disputed'
- `joined_at` (timestamp): When member joined
- `paid_at` (timestamp): When member fully paid

**Indexes**: group_payment_id, user_id, status
**Constraint**: (group_payment_id, user_id) is unique

### group_invites
- `id` (uuid): Primary key
- `group_payment_id` (uuid): Reference to group
- `to_email` (text): Invitee email address
- `token` (text): SHA256 hash of the invitation token
- `expires_at` (timestamp): Token expiration time
- `joined_at` (timestamp): When invite was accepted
- `joined_user_id` (uuid): User who accepted the invite

**Indexes**: token (fast lookup), group_payment_id, to_email
**Constraint**: (group_payment_id, to_email) is unique

## Service API

### createGroupPayment
```typescript
async function createGroupPayment(
  deps: ServiceDeps,
  groupOwnerId: string,
  options: CreateGroupPaymentOptions
): Promise<{ groupPaymentId: string; inviteLinks: Array<{ email: string; token: string }> }>
```

Creates a new group payment and sends invitation emails.

**Parameters**:
- `eventId`: Event being purchased for
- `strategy`: 'equal' | 'proportional' | 'custom'
- `orderIds`: List of initial orders to include
- `memberEmails`: List of emails to invite

**Returns**: Group ID and list of invitation tokens (for testing/logging)

### addMember
```typescript
async function addMember(
  deps: ServiceDeps,
  options: AddMemberOptions,
  requestingUserId: string
): Promise<GroupMember>
```

Add a member directly (no invitation). Only group owner can call.

### inviteMember
```typescript
async function inviteMember(
  deps: ServiceDeps,
  options: InviteMemberOptions,
  requestingUserId: string
): Promise<{ inviteLink: string; expiresAt: Date }>
```

Send invitation email to new member. Only group owner can call.

### acceptInvite
```typescript
async function acceptInvite(
  deps: ServiceDeps,
  options: AcceptInviteOptions
): Promise<GroupMember>
```

Accept an invitation and join the group. Validates token and checks expiration.

### calculateSplits
```typescript
async function calculateSplits(
  db: DbAdapter,
  groupPaymentId: string,
  strategy: string
): Promise<CalculateSplitsResult>
```

Calculate how much each member owes based on strategy.

**Rounding Behavior**: Last member absorbs all rounding errors (cents), ensuring total always equals group total.

### recordMemberPayment
```typescript
async function recordMemberPayment(
  deps: ServiceDeps,
  options: RecordMemberPaymentOptions
): Promise<GroupMember>
```

Record a payment from a group member. Can be partial or overpayment. Automatically marks member as 'paid' when full amount reached.

### finalizeGroupPayment
```typescript
async function finalizeGroupPayment(
  deps: ServiceDeps,
  groupPaymentId: string,
  requestingUserId: string
): Promise<void>
```

Mark group as complete. Only callable when all members have paid. Only group owner can call.

### getGroupPaymentStatus
```typescript
async function getGroupPaymentStatus(
  db: DbAdapter,
  groupPaymentId: string
): Promise<GroupPaymentResponse>
```

Get full group state including all members and their payment status.

### settlementReport
```typescript
async function settlementReport(
  db: DbAdapter,
  groupPaymentId: string
): Promise<SettlementReport>
```

Generate settlement report showing who owes what and who has paid.

## REST API Endpoints

### POST /api/groups
Create a new group payment.

```json
Request:
{
  "eventId": "event-123",
  "strategy": "equal",
  "orderIds": ["order-1"],
  "memberEmails": ["friend1@example.com", "friend2@example.com"]
}

Response:
{
  "groupPaymentId": "group-1",
  "inviteLinks": [
    { "email": "friend1@example.com", "token": "..." },
    { "email": "friend2@example.com", "token": "..." }
  ]
}
```

### GET /api/groups
List all groups for current user (as owner or member).

### GET /api/groups/[id]
Get group details including member breakdown.

### PATCH /api/groups/[id]
Update group strategy (only while status='pending').

```json
Request:
{
  "strategy": "proportional"
}
```

### POST /api/groups/[id]/members
Invite a new member to existing group.

```json
Request:
{
  "toEmail": "newmember@example.com",
  "expiresInDays": 7
}

Response:
{
  "inviteLink": "https://tixly.cz/groups/group-1/accept?token=...",
  "expiresAt": "2026-04-25T..."
}
```

### POST /api/groups/[id]/accept
Accept an invitation and join the group.

```json
Request:
{
  "token": "...",
  "orderId": "order-user2"
}

Response:
{
  "id": "member-2",
  "userId": "user-2",
  "orderId": "order-user2",
  "amountOwedHalire": 25000,
  "amountPaidHalire": 0,
  "status": "pending",
  "joinedAt": "2026-04-18T..."
}
```

### POST /api/groups/[id]/pay
Record a payment from current user.

```json
Request:
{
  "amount": 25000
}

Response:
{
  "memberStatus": { ... },
  "groupStatus": { ... }
}
```

### GET /api/groups/[id]/settlement
Get settlement report with balance breakdown.

```json
Response:
{
  "groupPaymentId": "group-1",
  "groupOwnerId": "owner-1",
  "eventId": "event-1",
  "totalAmount": 100000,
  "strategy": "equal",
  "status": "pending",
  "entries": [
    {
      "memberId": "member-1",
      "email": "user1@example.com",
      "userId": "user-1",
      "owedAmount": 50000,
      "paidAmount": 25000,
      "balance": 25000,
      "status": "pending"
    },
    {
      "memberId": "member-2",
      "email": "user2@example.com",
      "userId": "user-2",
      "owedAmount": 50000,
      "paidAmount": 50000,
      "balance": 0,
      "status": "paid"
    }
  ],
  "createdAt": "2026-04-18T..."
}
```

## Error Handling

All operations throw typed errors that should be caught and handled:

- `GroupPaymentNotFoundError`: Group doesn't exist
- `GroupPaymentInviteNotFoundError`: Invalid token
- `GroupPaymentInviteExpiredError`: Token has expired
- `InvalidGroupPaymentStrategyError`: Unknown strategy
- `GroupPaymentStatusError`: Operation invalid for current status
- `DuplicateGroupMemberError`: User already in group
- `UnauthorizedGroupPaymentError`: User doesn't have permission

## Testing

Run tests:
```bash
npm test
```

Watch mode:
```bash
npm run test:watch
```

Coverage:
```bash
npm run test:coverage
```

## Implementation Notes

1. **Token Security**: Invitation tokens are hashed with SHA256 before storage. Plain tokens are returned only once at creation and never stored.

2. **Transactions**: All multi-step operations use database transactions to ensure consistency.

3. **Rounding**: In equal and proportional splits, the last member absorbs all rounding errors (cents). This ensures the sum always equals the group total.

4. **Authorization**: 
   - Only group owner can add members, invite members, or finalize
   - Any member can view group details and settlement
   - Any authenticated user can accept an invite with valid token

5. **Overpayment**: Members can pay more than owed (e.g., rounding up for convenience). Status becomes 'paid' when amount >= owed.

6. **Email Async**: Invitation emails are sent fire-and-forget; email failure doesn't block the API response.
