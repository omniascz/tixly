# Wero SEPA Instant A2A Payment Integration

European Account-to-Account (A2A) payment processor integration with lower fees than traditional card payments.

## Overview

Wero provides SEPA Instant payments directly between bank accounts across Europe. This integration enables Tixly to offer lower-cost payment alternatives to event organizers and their customers.

## Architecture

### Types (`src/types/wero.ts`)

- **WeroPaymentStatus**: `'initiated' | 'authorized' | 'confirmed' | 'failed'`
- **WeroPayment**: Complete payment record with all timestamps and amounts
- **WeroWebhook**: Webhook payload from Wero API

### Client (`src/lib/wero-client.ts`)

Low-level HTTP wrapper with:
- OAuth2 client_credentials flow with token caching
- HMAC-SHA256 signature validation (timing-safe)
- DEV mode for testing without credentials
- Automatic retry logic via Wero API

### Service (`src/services/wero-payment.service.ts`)

Business logic layer:
- `initiateWeroPayment()` - Create payment record + call Wero API
- `confirmPayment()` - Mark as confirmed + trigger order-completed
- `updatePaymentStatus()` - Update status with appropriate timestamp
- `cancelPayment()` - Mark as failed + trigger refund
- `getWeroStats()` - Aggregate by promoter (count, volume, average)
- `logWebhookEvent()` - Audit trail

### Routes

#### `POST /api/payments/wero/initiate`
Initiates a new A2A payment. Requires authentication.

**Request:**
```json
{
  "orderId": "order-123",
  "returnUrl": "https://example.com/checkout/return"
}
```

**Response:**
```json
{
  "redirectUrl": "https://wero.io/authorize?...",
  "paymentId": "payment-uuid"
}
```

#### `POST /api/payments/wero/webhook`
Receives Wero webhook notifications. Validates HMAC-SHA256 signature.

**Webhook:**
```json
{
  "eventId": "event-123",
  "paymentId": "wero-ext-id",
  "status": "confirmed",
  "errorCode": null,
  "errorMessage": null
}
```

**On confirmed**: Fire-and-forget call to `/api/internal/order-completed`
**On failed**: Fire-and-forget call to `/api/internal/trigger-refund`

Always returns `200 OK` (idempotent).

#### `GET /api/payments/wero/:id`
Fetch payment status. No authentication required.

**Response:**
```json
{
  "id": "payment-uuid",
  "status": "confirmed",
  "orderId": "order-123",
  "amountHalire": 100000,
  "initiatedAt": "2026-04-18T00:00:00Z",
  "confirmedAt": "2026-04-18T01:00:00Z"
}
```

## Database Schema

### `payments.wero_payments`
- **id**: UUID primary key
- **order_id**: Reference to orders
- **promoter_id**: Tenant isolation
- **status**: Payment state
- **external_id**: Wero's payment ID (unique)
- **amount_halire**: Integer haléře (1 Kč = 100 haléřů)
- **iban_hash**: AES-256 encrypted for GDPR
- **initiated_at, authorized_at, confirmed_at**: State transition timestamps
- **error_code, error_message**: Failure details

### `payments.wero_webhooks` (Audit)
- **id**: UUID
- **payment_id**: FK to wero_payments
- **event_type**: Type of event
- **status**: Status from webhook
- **raw_payload**: Full JSONB for debugging
- **signature_valid**: Boolean flag
- **processed_at**: Audit timestamp

## Configuration

### Environment Variables
```bash
WERO_CLIENT_ID=your-client-id
WERO_CLIENT_SECRET=your-client-secret
WERO_API_BASE_URL=https://api.wero.io
WERO_WEBHOOK_SECRET=your-webhook-secret
INTERNAL_API_SECRET=your-internal-secret
NEXTAUTH_URL=http://localhost:3000
DATABASE_URL=postgresql://...
```

## Security

### Webhook Signature Validation
- All webhooks validated using HMAC-SHA256
- Timing-safe comparison prevents timing attacks
- Invalid signatures logged but processed as `200 OK` (no retry)
- Signature verification happens before DB queries

### IBAN Encryption
- IBANs encrypted with AES-256 in database
- `iban_hash` field for compliance
- Keys in environment variables

### Multi-tenant Isolation
- RLS policies on both tables
- `promoter_id` in WHERE clauses
- Admin override for support

## Testing

**Unit tests** (25-30 test cases):
- Token caching and expiration
- Signature verification (valid/invalid/timing-safe)
- Amount validation
- Status transitions
- Stats aggregation
- Idempotency

**Integration tests**:
- Full payment lifecycle
- Webhook processing
- Error scenarios
- Database transactions

Run tests:
```bash
npm test
npm run test:coverage
```

## Development Mode

When credentials are missing (`WERO_CLIENT_ID` or `WERO_CLIENT_SECRET` empty), the client operates in DEV mode:
- All API calls return stub responses
- Logging to console instead of external API
- Useful for local development without credentials

## Deployment Checklist

- [ ] Obtain Wero API credentials from dashboard
- [ ] Set environment variables in production
- [ ] Configure webhook URL in Wero settings
- [ ] Test webhook signature validation
- [ ] Run migration 236 on production database
- [ ] Monitor webhook delivery in logs
- [ ] Set up error alerts for failed payments
- [ ] Test refund flow with failed webhook
- [ ] Verify order-completed triggers on confirmation

## Monitoring

**Metrics to track:**
- Payment initiation rate
- Confirmation rate (target: >95%)
- Failure rate and reasons
- Average processing time
- Webhook delivery latency

**Logs to monitor:**
```
[wero-payments] initiate error:
[wero-payments] webhook error:
[wero-payments] Failed to trigger order-completed:
[wero-payments] Invalid webhook signature:
```

## References

- [Wero API Documentation](https://docs.wero.io)
- [SEPA Instant Payments](https://www.wero.io/sepa-instant)
- Migration: `migrations/236_wero_payments.sql`
