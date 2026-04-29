// =============================================================================
// Stripe Service
//
// Žádná závislost na `stripe` npm balíčku — čistý fetch (Node 18+ built-in).
// ENV proměnné: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
//
// Funkce:
//   createPaymentIntent   — vytvoří Stripe PaymentIntent a uloží ID na orders
//   handleStripeWebhook   — zpracuje ověřený Stripe webhook event
//   refundPayment         — (partial) refund přes Stripe Refunds API
//   verifyWebhookSignature — HMAC-SHA256 ověření + replay-attack ochrana
// =============================================================================

import { createHmac, timingSafeEqual } from 'crypto';
import { StripeError } from '../lib/stripe-errors';
import type { StripeDeps } from '../lib/service-container';

// ---------------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------------

export interface CreatePaymentIntentInput {
  orderId: string;
  amountHellers: number;   // INTEGER haléře (1 Kč = 100)
  currency: string;        // např. 'czk'
  metadata?: Record<string, string>;
}

export interface PaymentIntentResult {
  paymentIntentId: string;
  clientSecret: string;
  status: string;
}

interface OrderRow {
  id: string;
  status: string;
  amount_hellers: number;
  stripe_payment_intent_id: string | null;
}

// ---------------------------------------------------------------------------
// Interní helper — Stripe REST API volání
// ---------------------------------------------------------------------------

async function stripeRequest(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, string | number>,
): Promise<unknown> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new StripeError('STRIPE_API_ERROR', 'STRIPE_SECRET_KEY is not set.');
  }

  const url = `https://api.stripe.com${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  let requestBody: string | undefined;
  if (body && method === 'POST') {
    // Stripe REST API používá application/x-www-form-urlencoded
    requestBody = Object.entries(body)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
  }

  const response = await fetch(url, {
    method,
    headers,
    body: requestBody,
  });

  const json = await response.json() as Record<string, unknown>;

  if (!response.ok) {
    const errorMsg =
      typeof json['error'] === 'object' && json['error'] !== null
        ? String((json['error'] as Record<string, unknown>)['message'] ?? 'Unknown Stripe error')
        : 'Unknown Stripe error';
    throw new StripeError('STRIPE_API_ERROR', `Stripe API error: ${errorMsg}`);
  }

  return json;
}

// ---------------------------------------------------------------------------
// verifyWebhookSignature
//
// Stripe-Signature header formát: t=<timestamp>,v1=<hex-HMAC>
// Podpis: HMAC-SHA256(`${timestamp}.${rawBody}`, webhookSecret)
// Replay-attack ochrana: timestamp nesmí být starší než 300 sekund.
// ---------------------------------------------------------------------------

export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  webhookSecret: string,
): boolean {
  // Parsovat header: t=...,v1=...
  const parts = Object.fromEntries(
    signature.split(',').map((part) => {
      const eqIdx = part.indexOf('=');
      return [part.slice(0, eqIdx), part.slice(eqIdx + 1)];
    }),
  );

  const timestamp = parts['t'];
  const v1 = parts['v1'];

  if (!timestamp || !v1) {
    return false;
  }

  // Replay-attack ochrana: max 300 sekund staré
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || now - ts >= 300) {
    return false;
  }

  // HMAC-SHA256 výpočet
  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = createHmac('sha256', webhookSecret)
    .update(signedPayload, 'utf8')
    .digest();

  // Převod hex v1 na Buffer
  let receivedBuffer: Buffer;
  try {
    receivedBuffer = Buffer.from(v1, 'hex');
  } catch {
    return false;
  }

  if (expected.length !== receivedBuffer.length) {
    return false;
  }

  // Timing-safe porovnání (prevence timing útoku)
  return timingSafeEqual(expected, receivedBuffer);
}

// ---------------------------------------------------------------------------
// createPaymentIntent
// ---------------------------------------------------------------------------

export async function createPaymentIntent(
  input: CreatePaymentIntentInput,
  deps: StripeDeps,
): Promise<PaymentIntentResult> {
  const { db } = deps;
  const { orderId, amountHellers, currency, metadata = {} } = input;

  // Ověřit existenci objednávky
  const [order] = await db.query<OrderRow>(
    'SELECT id, status, amount_hellers FROM orders.orders WHERE id = $1',
    [orderId],
  );

  if (!order) {
    throw new StripeError('ORDER_NOT_FOUND');
  }

  if (order.status === 'paid') {
    throw new StripeError('ALREADY_PAID');
  }

  // Sestavit parametry pro Stripe API
  const stripeBody: Record<string, string | number> = {
    amount: amountHellers,
    currency: currency.toLowerCase(),
    'metadata[order_id]': orderId,
    'automatic_payment_methods[enabled]': 'true',
  };

  // Přidat vlastní metadata
  for (const [key, value] of Object.entries(metadata)) {
    stripeBody[`metadata[${key}]`] = value;
  }

  // Volat Stripe API
  const result = await stripeRequest('POST', '/v1/payment_intents', stripeBody) as {
    id: string;
    client_secret: string;
    status: string;
  };

  // Uložit stripe_payment_intent_id na objednávku
  await db.execute(
    `UPDATE orders.orders
     SET stripe_payment_intent_id = $1,
         payment_provider = 'stripe'
     WHERE id = $2`,
    [result.id, orderId],
  );

  // Zapsat do payment_events (immutable log)
  await db.execute(
    `INSERT INTO orders.payment_events
       (order_id, event_type, payment_provider, amount_hellers, raw_payload)
     VALUES ($1, 'payment_intent.created', 'stripe', $2, $3)`,
    [orderId, amountHellers, JSON.stringify({ paymentIntentId: result.id, status: result.status })],
  );

  return {
    paymentIntentId: result.id,
    clientSecret: result.client_secret,
    status: result.status,
  };
}

// ---------------------------------------------------------------------------
// handleStripeWebhook
// ---------------------------------------------------------------------------

export async function handleStripeWebhook(
  rawBody: string,
  signature: string,
  deps: StripeDeps,
): Promise<void> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new StripeError('INVALID_WEBHOOK_SIGNATURE', 'STRIPE_WEBHOOK_SECRET is not set.');
  }

  // Ověřit podpis
  if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
    throw new StripeError('INVALID_WEBHOOK_SIGNATURE');
  }

  const event = JSON.parse(rawBody) as {
    id: string;
    type: string;
    data: { object: Record<string, unknown> };
  };

  const { db } = deps;

  // Idempotency: zkontrolovat stripe_event_id v payment_events
  const existing = await db.query<{ id: string }>(
    'SELECT id FROM orders.payment_events WHERE stripe_event_id = $1 LIMIT 1',
    [event.id],
  );

  if (existing.length > 0) {
    throw new StripeError('DUPLICATE_EVENT');
  }

  const eventObj = event.data.object;

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const paymentIntentId = String(eventObj['id'] ?? '');
      await db.execute(
        `UPDATE orders.orders SET status = 'paid' WHERE stripe_payment_intent_id = $1`,
        [paymentIntentId],
      );
      const [order] = await db.query<{ id: string }>(
        'SELECT id FROM orders.orders WHERE stripe_payment_intent_id = $1',
        [paymentIntentId],
      );
      if (order) {
        await db.execute(
          `INSERT INTO orders.payment_events
             (order_id, event_type, payment_provider, stripe_event_id, raw_payload)
           VALUES ($1, 'payment_intent.succeeded', 'stripe', $2, $3)`,
          [order.id, event.id, rawBody],
        );
      }
      break;
    }

    case 'payment_intent.payment_failed': {
      const paymentIntentId = String(eventObj['id'] ?? '');
      await db.execute(
        `UPDATE orders.orders SET status = 'cancelled' WHERE stripe_payment_intent_id = $1`,
        [paymentIntentId],
      );
      const [order] = await db.query<{ id: string }>(
        'SELECT id FROM orders.orders WHERE stripe_payment_intent_id = $1',
        [paymentIntentId],
      );
      if (order) {
        await db.execute(
          `INSERT INTO orders.payment_events
             (order_id, event_type, payment_provider, stripe_event_id, raw_payload)
           VALUES ($1, 'payment_intent.payment_failed', 'stripe', $2, $3)`,
          [order.id, event.id, rawBody],
        );
      }
      break;
    }

    case 'charge.refunded': {
      // charge objekt obsahuje payment_intent ID
      const paymentIntentId = String(eventObj['payment_intent'] ?? '');
      await db.execute(
        `UPDATE orders.orders SET status = 'refunded' WHERE stripe_payment_intent_id = $1`,
        [paymentIntentId],
      );
      const [order] = await db.query<{ id: string }>(
        'SELECT id FROM orders.orders WHERE stripe_payment_intent_id = $1',
        [paymentIntentId],
      );
      if (order) {
        await db.execute(
          `INSERT INTO orders.payment_events
             (order_id, event_type, payment_provider, stripe_event_id, raw_payload)
           VALUES ($1, 'charge.refunded', 'stripe', $2, $3)`,
          [order.id, event.id, rawBody],
        );
      }
      break;
    }

    case 'charge.dispute.created': {
      const paymentIntentId = String(eventObj['payment_intent'] ?? '');
      await db.execute(
        `UPDATE orders.orders SET status = 'chargeback' WHERE stripe_payment_intent_id = $1`,
        [paymentIntentId],
      );
      const [order] = await db.query<{ id: string }>(
        'SELECT id FROM orders.orders WHERE stripe_payment_intent_id = $1',
        [paymentIntentId],
      );
      if (order) {
        await db.execute(
          `INSERT INTO orders.payment_events
             (order_id, event_type, payment_provider, stripe_event_id, raw_payload)
           VALUES ($1, 'charge.dispute.created', 'stripe', $2, $3)`,
          [order.id, event.id, rawBody],
        );
      }
      break;
    }

    default:
      // Neznámý event typ — tiše ignorovat (Stripe posílá mnoho event typů)
      break;
  }
}

// ---------------------------------------------------------------------------
// refundPayment
// ---------------------------------------------------------------------------

export async function refundPayment(
  orderId: string,
  amountHellers: number,
  reason: string,
  deps: StripeDeps,
): Promise<void> {
  const { db } = deps;

  // Načíst objednávku
  const [order] = await db.query<OrderRow>(
    'SELECT id, status, amount_hellers, stripe_payment_intent_id FROM orders.orders WHERE id = $1',
    [orderId],
  );

  if (!order) {
    throw new StripeError('ORDER_NOT_FOUND');
  }

  if (!order.stripe_payment_intent_id) {
    throw new StripeError('PAYMENT_INTENT_NOT_FOUND');
  }

  // Partial refund guard: nesmí refundovat více než zaplacená částka
  if (amountHellers > order.amount_hellers) {
    throw new StripeError('REFUND_EXCEEDS_AMOUNT');
  }

  // Mapovat Stripe refund reason hodnoty
  const stripeReason = mapRefundReason(reason);

  const refundBody: Record<string, string | number> = {
    payment_intent: order.stripe_payment_intent_id,
    amount: amountHellers,
  };
  if (stripeReason) {
    refundBody['reason'] = stripeReason;
  }

  // Volat Stripe Refunds API
  const refundResult = await stripeRequest('POST', '/v1/refunds', refundBody) as {
    id: string;
    status: string;
    amount: number;
  };

  // Zapsat do payment_events (immutable log)
  await db.execute(
    `INSERT INTO orders.payment_events
       (order_id, event_type, payment_provider, amount_hellers, raw_payload)
     VALUES ($1, 'refund.created', 'stripe', $2, $3)`,
    [
      orderId,
      amountHellers,
      JSON.stringify({
        refundId: refundResult.id,
        refundStatus: refundResult.status,
        amountHellers,
        reason,
      }),
    ],
  );
}

// ---------------------------------------------------------------------------
// Helper — mapovat interní reason na Stripe hodnoty
// Stripe přijímá: 'duplicate', 'fraudulent', 'requested_by_customer'
// ---------------------------------------------------------------------------

function mapRefundReason(reason: string): string | null {
  const map: Record<string, string> = {
    duplicate: 'duplicate',
    fraudulent: 'fraudulent',
    fraud: 'fraudulent',
    requested_by_customer: 'requested_by_customer',
    customer_request: 'requested_by_customer',
  };
  return map[reason.toLowerCase()] ?? null;
}
