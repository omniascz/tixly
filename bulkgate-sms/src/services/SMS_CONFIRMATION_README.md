# SMS Confirmation Service

Provides 6-digit verification code SMS delivery with opt-out tracking and admin management.

## Features

- Generate random 6-digit confirmation codes
- Send single/bulk SMS confirmations
- Track opt-out preferences
- Admin override capability
- Kafka event publishing
- Comprehensive error handling

## API Endpoints

### POST `/api/sms/confirmation/send`

Send a single confirmation SMS.

**Request:**
```json
{
  "phoneNumber": "+420777123456",
  "code": "123456",
  "eventName": "Koncert 2026",
  "eventId": "uuid",
  "promoterId": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "messageId": "conf-123",
  "sentAt": "2026-04-18T10:30:00Z",
  "phone": "+420777123456"
}
```

**Error Codes:**
- `SMS_INVALID_PHONE`: Invalid phone number format
- `SMS_INVALID_CODE`: Code must be 6 digits
- `SMS_PROVIDER_ERROR`: BulkGate API error

---

### POST `/api/sms/confirmation/bulk`

Batch send confirmation codes (admin only).

**Headers:**
- `x-user-id`: User UUID
- `x-user-role`: Must be "admin"

**Request:**
```json
{
  "phoneNumbers": ["+420777111111", "+420777222222"],
  "code": "123456",
  "eventName": "Festival",
  "eventId": "uuid",
  "promoterId": "uuid"
}
```

**Response:**
```json
{
  "sent": 1,
  "failed": 1,
  "results": [
    {
      "phone": "+420777111111",
      "success": true,
      "messageId": "conf-001"
    },
    {
      "phone": "+420777222222",
      "success": false,
      "error": "invalid_phone"
    }
  ]
}
```

**Constraints:**
- Max 1000 phones per request
- Admin role required

---

### POST `/api/sms/confirmation/opt-out`

User opts out from SMS (no auth required).

**Request:**
```json
{
  "phoneNumber": "+420777123456",
  "userId": "uuid",
  "reason": "Příliš mnoho SMS"
}
```

**Response:**
```json
{
  "success": true,
  "optedOut": true,
  "phone": "+420777123456"
}
```

---

### DELETE `/api/sms/confirmation/opt-out`

Admin removes opt-out (admin only).

**Headers:**
- `x-user-id`: User UUID
- `x-user-role`: Must be "admin"

**Request:**
```json
{
  "phoneNumber": "+420777123456"
}
```

**Response:**
```json
{
  "success": true,
  "optedOut": false,
  "phone": "+420777123456"
}
```

---

## Service Functions

### `sendConfirmationSms(input, deps)`

Send 6-digit confirmation code via SMS.

```typescript
const result = await sendConfirmationSms(
  {
    phoneNumber: '+420777123456',
    code: '123456',
    eventName: 'Concert',
    eventId: 'uuid',
    promoterId: 'uuid',
  },
  deps
);

// Returns: { success, messageId, sentAt, phone }
```

### `sendBulkConfirmationSms(input, deps)`

Batch send confirmation codes with partial failure handling.

```typescript
const result = await sendBulkConfirmationSms(
  {
    phoneNumbers: ['+420777111111', '+420777222222'],
    code: '123456',
    eventName: 'Concert',
    eventId: 'uuid',
  },
  deps
);

// Returns: { sent, failed, results[] }
```

### `isOptedOut(phoneNumber, deps)`

Check if phone is opted out.

```typescript
const optedOut = await isOptedOut('+420777123456', deps);
// Returns: boolean
```

### `addOptOut(phoneNumber, userId, reason, deps)`

User opts out from SMS.

```typescript
const result = await addOptOut(
  '+420777123456',
  'user-uuid',
  'Příliš mnoho SMS',
  deps
);

// Returns: { success, optedOut, phone }
```

### `removeOptOut(phoneNumber, deps)`

Admin removes opt-out.

```typescript
const result = await removeOptOut('+420777123456', deps);

// Returns: { success, optedOut, phone }
```

### `getOptOuts(deps, limit, offset)`

Get all opt-outs (admin).

```typescript
const { items, total } = await getOptOuts(deps, 50, 0);

// items: OptOutEntry[]
// total: number
```

### `generateConfirmationCode()`

Generate random 6-digit code.

```typescript
const code = generateConfirmationCode();
// Returns: "123456"
```

### `normalizePhone(phone)`

Normalize to E.164 format.

```typescript
const normalized = normalizePhone('+420 777 123 456');
// Returns: "+420777123456"
```

---

## Kafka Events

### `sms.confirmation.sent`

Emitted when SMS sent successfully.

```json
{
  "messageId": "conf-123",
  "phone": "+420777123456",
  "eventName": "Concert",
  "eventId": "uuid",
  "promoterId": "uuid",
  "externalId": "bg-xyz",
  "optedOut": false
}
```

### `sms.confirmation.failed`

Emitted when SMS send fails.

```json
{
  "messageId": "conf-123",
  "phone": "+420777123456",
  "eventName": "Concert",
  "eventId": "uuid",
  "promoterId": "uuid",
  "errorMessage": "Invalid number"
}
```

### `sms.confirmation.bulk_completed`

Emitted when bulk send completes.

```json
{
  "eventId": "uuid",
  "eventName": "Concert",
  "promoterId": "uuid",
  "total": 100,
  "sent": 95,
  "failed": 5
}
```

---

## Database Schema

### `sms.confirmation_sms`

```sql
CREATE TABLE sms.confirmation_sms (
  id UUID PRIMARY KEY,
  recipient_phone TEXT NOT NULL,
  confirmation_code TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_id UUID,
  promoter_id UUID,
  status TEXT NOT NULL,
  external_id TEXT,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
);
```

### `sms.opt_outs`

```sql
ALTER TABLE sms.opt_outs ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE sms.opt_outs ADD COLUMN IF NOT EXISTS reason TEXT;
```

---

## Error Handling

### Common Errors

| Code | Status | Meaning |
|------|--------|---------|
| `SMS_INVALID_PHONE` | 400 | Phone format invalid |
| `SMS_INVALID_CODE` | 400 | Code must be 6 digits |
| `INVALID_JSON` | 400 | Request body not valid JSON |
| `VALIDATION_ERROR` | 400 | Schema validation failed |
| `FORBIDDEN` | 403 | Insufficient role (admin only) |
| `SMS_PROVIDER_ERROR` | 500 | BulkGate API error |
| `INTERNAL_ERROR` | 500 | Server error |

---

## Testing

Run tests:

```bash
npm test -- sms-confirmation
```

Test coverage includes:
- Code generation
- Phone validation
- Opt-out management
- Single SMS sending
- Bulk SMS sending
- Error scenarios
- Kafka event publishing
- Route validation
- Admin authorization

---

## Configuration

Requires environment variables:
- `DATABASE_URL`: PostgreSQL connection string
- `BULKGATE_APP_ID`: BulkGate application ID
- `BULKGATE_APP_TOKEN`: BulkGate API token
- `BULKGATE_SENDER_ID`: BulkGate sender ID
- `KAFKA_REST_URL`: Kafka REST proxy URL (optional)

---

## Migration

Run migration after deployment:

```sql
-- 077_sms_confirmation.sql handles:
-- - Create confirmation_sms table
-- - Add user_id and reason to opt_outs
-- - Create necessary indexes
```
