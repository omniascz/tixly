/**
 * PayPal Payouts API.
 *
 * Reuses OAuth token infrastructure from src/lib/payment/paypal.ts.
 * PayPal Payouts is a separate permission scope (PAYPAL_PAYOUTS) from Orders API.
 *
 * Flow:
 *   1. Get OAuth access_token (PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET)
 *   2. POST /v1/payments/payouts — create batch payout
 *   3. GET /v1/payments/payouts/{batch_id} — poll for UNCLAIMED → PENDING → SUCCESS/FAILED
 *
 * Payout identifier:
 *   receiver = promoter's PayPal email (stored in promoters.paypal_payout_email)
 *   sender_item_id = our payout UUID (idempotent)
 *
 * Env vars:
 *   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_SANDBOX
 *   (Same as payment/paypal.ts — payouts scope auto-granted for business accounts)
 */

const PAYPAL_BASE = process.env.PAYPAL_SANDBOX === '1'
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com';

// ─── Token (shared with payment/paypal.ts logic but kept independent) ─

interface TokenCache { token: string; expiresAt: number }
let _tokenCache: TokenCache | null = null;

async function getPayPalAccessToken(): Promise<string> {
  const now = Date.now();
  if (_tokenCache && _tokenCache.expiresAt > now + 30_000) return _tokenCache.token;

  const clientId = process.env.PAYPAL_CLIENT_ID ?? '';
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET ?? '';
  if (!clientId || !clientSecret) throw new Error('PAYPAL credentials not configured');

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`PayPal token error ${res.status}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  _tokenCache = { token: data.access_token, expiresAt: now + data.expires_in * 1000 };
  return data.access_token;
}

// ─── Payout API ───────────────────────────────────────────────────────

export interface PayPalPayoutItem {
  sender_item_id: string;
  receiver: string;     // PayPal email
  amountValue: string;  // e.g. "150.00"
  currency: string;     // e.g. "EUR"
  note?: string;
}

export interface PayPalPayoutResult {
  batchId: string;
  status: string;
  items: Array<{ senderItemId: string; payoutItemId: string; transactionStatus: string }>;
}

/**
 * Create a PayPal batch payout.
 *
 * @param senderBatchId  Unique ID for idempotency (use our payout UUID)
 */
export async function createPayPalPayout(input: {
  senderBatchId: string;
  emailSubject: string;
  items: PayPalPayoutItem[];
}): Promise<PayPalPayoutResult> {
  const token = await getPayPalAccessToken();

  const body = {
    sender_batch_header: {
      sender_batch_id: input.senderBatchId,
      email_subject: input.emailSubject,
      recipient_type: 'EMAIL',
    },
    items: input.items.map((item) => ({
      recipient_type: 'EMAIL',
      amount: { value: item.amountValue, currency: item.currency },
      receiver: item.receiver,
      sender_item_id: item.sender_item_id,
      note: item.note ?? 'Tixly výplata',
    })),
  };

  const res = await fetch(`${PAYPAL_BASE}/v1/payments/payouts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': input.senderBatchId, // idempotency key
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PayPal Payouts API ${res.status}: ${text}`);
  }

  const data = await res.json() as {
    batch_header: { payout_batch_id: string; batch_status: string };
    items?: Array<{ payout_item: { sender_item_id: string }; payout_item_id: string; transaction_status: string }>;
  };

  return {
    batchId: data.batch_header.payout_batch_id,
    status: data.batch_header.batch_status,
    items: (data.items ?? []).map((i) => ({
      senderItemId: i.payout_item.sender_item_id,
      payoutItemId: i.payout_item_id,
      transactionStatus: i.transaction_status,
    })),
  };
}

/**
 * Get payout batch status for reconciliation.
 */
export async function getPayPalPayoutStatus(batchId: string): Promise<string> {
  const token = await getPayPalAccessToken();
  const res = await fetch(`${PAYPAL_BASE}/v1/payments/payouts/${batchId}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`PayPal payout status ${res.status}`);
  const data = await res.json() as { batch_header: { batch_status: string } };
  return data.batch_header.batch_status;
}
