# SMS Marketing Campaigns — Implementation Guide

## Overview

This module implements task #207: SMS marketing campaigns with segmentation and scheduling. It provides a complete campaign builder for promotional and informational SMS messages, targeting users based on sophisticated segmentation rules.

**Key features:**
- Campaign builder with validation (160 character SMS limit)
- Recipient segmentation with AND logic (all rules must match)
- Scheduled/immediate delivery
- Batch sending via BulkGate (100 recipients per request)
- Performance analytics and metrics

---

## Architecture

### Components

1. **Types** (`src/lib/types.ts`)
   - Campaign, CampaignStatistic, SegmentRule definitions
   - Type enums: CampaignType, CampaignStatus, SegmentOperator, SegmentRuleType

2. **Campaign Service** (`src/services/campaign.service.ts`)
   - Core business logic: create, publish, execute, track
   - Functions: createCampaign, publishCampaign, executeCampaignSend, getCampaign, updateCampaign, deleteCampaign, listCampaigns
   - Validation: body length (160 chars max), segment rules
   - Status transitions: pending → scheduled/sent → archived

3. **Segmentation Service** (`src/services/segmentation.service.ts`)
   - Evaluate user eligibility against segment rules
   - Functions: evaluateSegment, evaluateSegments, getSegmentSize, getSampleRecipients
   - Segment types: event_type, geography, age, purchase_history, engagement_level
   - AND logic: user must match ALL rules to be included

4. **API Routes** (`src/app/api/campaigns/*`)
   - `GET /api/campaigns` — list campaigns with pagination
   - `POST /api/campaigns` — create campaign
   - `GET /api/campaigns/:id` — get campaign details
   - `PATCH /api/campaigns/:id` — update campaign
   - `DELETE /api/campaigns/:id` — soft delete (archive)
   - `POST /api/campaigns/:id/publish` — schedule/send
   - `POST /api/campaigns/:id/preview` — preview segment size & samples

---

## Segment Rules

### Rule Types

| Type | Description | Values | Example |
|------|-------------|--------|---------|
| `event_type` | Event categories from order history | concert, festival, cinema, comedy | `["concert", "festival"]` |
| `geography` | City/region from user address | City names | `["Prague", "Brno"]` |
| `age` | Age bucket from verified identity | 18-25, 26-40, 40+ | `["26-40"]` |
| `purchase_history` | Spending/frequency patterns | high_spender, repeat, one_time, inactive | `["repeat"]` |
| `engagement_level` | User interaction signals | opened_email, attended_event, referred_friend | `["attended_event"]` |

### Age Buckets

- **18-25**: Age >= 18 AND <= 25
- **26-40**: Age >= 26 AND <= 40
- **40+**: Age >= 40

### Purchase History Categories

- **high_spender**: Total spent > 5000 CZK
- **repeat**: 2 or more orders
- **one_time**: Exactly 1 order
- **inactive**: No purchase in 180+ days

### AND Logic

All rules are combined with AND logic. User must match **every** rule to be included.

```typescript
// User matches if:
// - Has attended a concert OR festival (event_type)
// - AND lives in Prague (geography)
// - AND is 26-40 years old (age)

const rules: SegmentRule[] = [
  { type: 'event_type', operator: 'in', values: ['concert', 'festival'] },
  { type: 'geography', operator: 'equals', values: ['Prague'] },
  { type: 'age', operator: 'equals', values: ['26-40'] },
];
```

---

## Campaign Lifecycle

### 1. Create (Status: `pending`)

```typescript
const campaign = await createCampaign(
  promoterId,
  'Summer Sale',
  'promotional',
  'Get 30% off! Code: SUMMER30',  // max 160 chars
  [{ type: 'event_type', operator: 'equals', values: ['concert'] }],
  db,
);
// campaign.status = 'pending'
```

### 2. Publish (Status: `scheduled` or `sent`)

**Immediate send** (scheduledAt <= now):
```typescript
const published = await publishCampaign(
  campaignId,
  new Date().toISOString(),  // or past time
  db,
);
// published.status = 'sent'
```

**Scheduled send** (scheduledAt > now):
```typescript
const published = await publishCampaign(
  campaignId,
  new Date(Date.now() + 3600000).toISOString(),  // 1 hour from now
  db,
);
// published.status = 'scheduled'
```

### 3. Execute (for scheduled campaigns)

Background job/cron runs periodically:
```typescript
// Check campaigns with status='scheduled' AND now >= scheduledAt
const { sentCount, failedCount } = await executeCampaignSend(
  campaignId,
  db,
  bulkGateClient,
);
// campaign.status = 'sent'
// campaign.sentAt = NOW()
// campaign_statistics updated
```

### 4. Delete (Status: `archived`)

Soft delete only:
```typescript
await deleteCampaign(campaignId, db);
// campaign.status = 'archived'
```

---

## Database Schema

### campaigns table

```sql
CREATE TABLE sms_marketing.campaigns (
  id UUID PRIMARY KEY,
  promoter_id UUID NOT NULL,
  name TEXT NOT NULL,
  type VARCHAR(20) NOT NULL,  -- 'informational' | 'promotional'
  body TEXT NOT NULL,         -- SMS message (max 160 chars)
  segment_rules JSONB NOT NULL,  -- JSON array of SegmentRule objects
  scheduled_at TIMESTAMP WITH TIME ZONE,
  sent_at TIMESTAMP WITH TIME ZONE,
  status VARCHAR(20) NOT NULL,  -- 'pending' | 'scheduled' | 'sent' | 'archived'
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE
);
```

### campaign_statistics table

```sql
CREATE TABLE sms_marketing.campaign_statistics (
  campaign_id UUID PRIMARY KEY,
  sent_count INT DEFAULT 0,
  failed_count INT DEFAULT 0,
  bounced_count INT DEFAULT 0,
  click_count INT DEFAULT 0,
  unsubscribe_count INT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE
);
```

---

## API Examples

### Create Campaign

```bash
POST /api/campaigns
Content-Type: application/json

{
  "name": "Summer Concert Promo",
  "type": "promotional",
  "body": "Don't miss summer concerts! Book now and save 20%.",
  "segmentRules": [
    {
      "type": "event_type",
      "operator": "equals",
      "values": ["concert"]
    },
    {
      "type": "purchase_history",
      "operator": "equals",
      "values": ["repeat"]
    }
  ]
}

# Response
{
  "id": "camp-123",
  "status": "pending",
  "name": "Summer Concert Promo"
}
```

### Preview Segment

```bash
POST /api/campaigns/camp-123/preview
Content-Type: application/json

{
  "segmentRules": [
    {
      "type": "event_type",
      "operator": "equals",
      "values": ["concert"]
    },
    {
      "type": "geography",
      "operator": "equals",
      "values": ["Prague"]
    }
  ]
}

# Response
{
  "segmentSize": 427,
  "exampleRecipients": [
    {
      "userId": "user-001",
      "phone": "+420722123456",
      "eventType": "concert",
      "lastPurchaseDate": "2026-04-15"
    },
    {
      "userId": "user-002",
      "phone": "+420722123457",
      "eventType": "concert",
      "lastPurchaseDate": "2026-04-14"
    }
  ]
}
```

### Publish Campaign

```bash
POST /api/campaigns/camp-123/publish
Content-Type: application/json

{
  "scheduledAt": "2026-04-19T15:00:00Z"
}

# Response
{
  "id": "camp-123",
  "status": "scheduled",
  "scheduledAt": "2026-04-19T15:00:00Z",
  "recipientCount": 427
}
```

### List Campaigns

```bash
GET /api/campaigns?limit=20&offset=0

# Response
{
  "campaigns": [
    {
      "id": "camp-123",
      "name": "Summer Concert Promo",
      "type": "promotional",
      "status": "scheduled",
      "scheduledAt": "2026-04-19T15:00:00Z",
      "stats": {
        "sentCount": 0,
        "failedCount": 0,
        ...
      }
    }
  ],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "total": 42,
    "hasMore": true
  }
}
```

---

## Integration with BulkGate

The service integrates with BulkGate via the `BulkGateClient` interface:

```typescript
export interface BulkGateClient {
  sendBulk(phones: string[], text: string): Promise<{
    accepted: string[];
    rejected: Array<{ phone: string; reason: string }>;
  }>;
}
```

**Batching:**
- Sends in groups of 100 recipients per request
- Updates campaign_statistics with accepted/rejected counts
- Failures are tracked but don't block the campaign

**In production:**
- Inject the real BulkGate client from `bulkgate-sms` module
- Use transactional boundaries to ensure atomicity

---

## Validation Rules

### Campaign Body

- **Required**: Cannot be empty
- **Max length**: 160 characters (SMS standard)
- **No validation**: Content (HTML, special chars allowed)

### Segment Rules

- **Type validation**: Must match defined types
- **Operator validation**: Must match defined operators
- **Values validation**: At least one value required
- **Empty rules**: Treated as no filtering (include all)

### Publishing

- **Status check**: Cannot republish sent campaigns
- **Recipients check**: Must have at least one matching recipient
- **Time validation**: Accepts ISO 8601 timestamps

---

## Testing

The module includes 30+ tests covering:

- **Campaign CRUD** (create, read, update, delete)
- **Validation** (body length, rules, timestamps)
- **Segmentation** (each segment type, AND logic, edge cases)
- **Publishing** (immediate vs scheduled)
- **Execution** (batching, rejections, stats updates)
- **API** (authorization, pagination, error handling)

Run tests:
```bash
npm test
npm run test:watch
```

---

## Configuration

### Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `BULKGATE_APP_ID` | BulkGate application ID | `app-123` |
| `BULKGATE_APP_TOKEN` | BulkGate API token | `token-xyz` |
| `DATABASE_URL` | PostgreSQL connection | `postgresql://...` |

### Feature Flags (optional)

Future: Add feature flags for A/B testing, gradual rollout.

---

## Known Limitations & TODO

1. **No UI**: This is backend-only. Frontend dashboard needed for campaign management.
2. **Click tracking**: Click/unsubscribe counts are placeholder. Requires URL shortening + webhook.
3. **Template variables**: No support for {{firstName}}, {{eventName}} personalization yet.
4. **Rate limiting**: No per-promoter rate limits. Add if needed.
5. **Retry logic**: Failed sends are not auto-retried. Consider adding.
6. **Scheduled job**: No built-in scheduler. Use `node-cron` or external job queue.

---

## Deployment Checklist

- [ ] Run migration 237 to create tables
- [ ] Configure BulkGate credentials
- [ ] Set up scheduled job to execute `executeCampaignSend` every minute
- [ ] Deploy API routes
- [ ] Run test suite
- [ ] Set up monitoring/alerting for failed sends

---

## Related Features

- **#180 SMS opt-in**: Consent collection (feeds recipient list)
- **#17 SMS confirmation**: Transactional SMS via BulkGate
- **#198 Refund engine**: May send info SMS on refund
- **#205 i18n**: Multi-language campaign templates
- **#200 Feature flags**: Gradual rollout of campaign variants
