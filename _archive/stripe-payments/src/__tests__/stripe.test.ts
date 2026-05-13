import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import {
  verifyWebhookSignature,
  createPaymentIntent,
  handleStripeWebhook,
  refundPayment,
  type CreatePaymentIntentInput,
} from '../services/stripe.service';
import { StripeError } from '../lib/stripe-errors';
import type { StripeDeps } from '../lib/service-container';

// =============================================================================
// Helpers
// =============================================================================

function makeDb(queryResults: unknown[][] = []) {
  let idx = 0;
  return {
    query: vi.fn().mockImplementation(() => Promise.resolve(queryResults[idx++] ?? [])),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(),
  };
}

function makeDeps(db: ReturnType<typeof makeDb>): StripeDeps {
  return { db: db as unknown as StripeDeps['db'] };
}

// Sestavit platný Stripe-Signature header
function buildStripeSignature(
  rawBody: string,
  secret: string,
  timestampOverride?: number,
): string {
  const ts = timestampOverride ?? Math.floor(Date.now() / 1000);
  const signed = `${ts}.${rawBody}`;
  const hmac = createHmac('sha256', secret).update(signed, 'utf8').digest('hex');
  return `t=${ts},v1=${hmac}`;
}

const TEST_SECRET = 'whsec_test_secret_key_12345';

// Stavový Stripe Event helper
function makeStripeEvent(type: string, objectData: Record<string, unknown>, eventId = 'evt_test_001') {
  return JSON.stringify({
    id: eventId,
    type,
    data: { object: objectData },
  });
}

// =============================================================================
// 1. verifyWebhookSignature
// =============================================================================

describe('verifyWebhookSignature', () => {
  it('vrátí true pro platný podpis', () => {
    const body = '{"id":"evt_001","type":"payment_intent.succeeded"}';
    const sig = buildStripeSignature(body, TEST_SECRET);
    expect(verifyWebhookSignature(body, sig, TEST_SECRET)).toBe(true);
  });

  it('vrátí false pro pozměněný payload', () => {
    const body = '{"id":"evt_001","type":"payment_intent.succeeded"}';
    const tamperedBody = '{"id":"evt_001","type":"payment_intent.succeeded","extra":"injected"}';
    const sig = buildStripeSignature(body, TEST_SECRET);
    expect(verifyWebhookSignature(tamperedBody, sig, TEST_SECRET)).toBe(false);
  });

  it('vrátí false pro špatný secret', () => {
    const body = '{"id":"evt_001","type":"payment_intent.succeeded"}';
    const sig = buildStripeSignature(body, 'wrong_secret');
    expect(verifyWebhookSignature(body, sig, TEST_SECRET)).toBe(false);
  });

  it('vrátí false pro replay attack — timestamp > 300 sekund', () => {
    const body = '{"id":"evt_001","type":"payment_intent.succeeded"}';
    const oldTimestamp = Math.floor(Date.now() / 1000) - 301;
    const sig = buildStripeSignature(body, TEST_SECRET, oldTimestamp);
    expect(verifyWebhookSignature(body, sig, TEST_SECRET)).toBe(false);
  });

  it('vrátí true pro timestamp na hranici tolerance (299 sekund)', () => {
    const body = '{"id":"evt_001","type":"payment_intent.succeeded"}';
    const recentTimestamp = Math.floor(Date.now() / 1000) - 299;
    const sig = buildStripeSignature(body, TEST_SECRET, recentTimestamp);
    expect(verifyWebhookSignature(body, sig, TEST_SECRET)).toBe(true);
  });

  it('vrátí false pro timestamp přesně = 300 sekund (hraniční podmínka)', () => {
    const body = '{"id":"evt_001","type":"payment_intent.succeeded"}';
    const borderTimestamp = Math.floor(Date.now() / 1000) - 300;
    const sig = buildStripeSignature(body, TEST_SECRET, borderTimestamp);
    // 300 sekund je přesně na hranici — now - ts === 300 → zamítnout
    expect(verifyWebhookSignature(body, sig, TEST_SECRET)).toBe(false);
  });

  it('vrátí false pro chybějící t= část', () => {
    const body = '{"id":"evt_001"}';
    const hmac = createHmac('sha256', TEST_SECRET).update(`fake.${body}`, 'utf8').digest('hex');
    const sig = `v1=${hmac}`; // bez t=
    expect(verifyWebhookSignature(body, sig, TEST_SECRET)).toBe(false);
  });

  it('vrátí false pro chybějící v1= část', () => {
    const body = '{"id":"evt_001"}';
    const ts = Math.floor(Date.now() / 1000);
    const sig = `t=${ts}`; // bez v1=
    expect(verifyWebhookSignature(body, sig, TEST_SECRET)).toBe(false);
  });
});

// =============================================================================
// 2. handleStripeWebhook
// =============================================================================

describe('handleStripeWebhook — payment_intent.succeeded → paid', () => {
  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = TEST_SECRET;
  });
  afterEach(() => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  it('nastaví orders.status = paid', async () => {
    const rawBody = makeStripeEvent('payment_intent.succeeded', {
      id: 'pi_test_001',
      amount: 50000,
      currency: 'czk',
    });
    const sig = buildStripeSignature(rawBody, TEST_SECRET);

    const db = makeDb([
      [],                           // stripe_event_id kontrola → žádný duplicit
      undefined as unknown as unknown[], // UPDATE orders (execute, ne query)
      [{ id: 'order-uuid-001' }],   // SELECT id by payment_intent
    ]);

    await handleStripeWebhook(rawBody, sig, makeDeps(db));

    // První execute = UPDATE status = 'paid'
    const updateCall = db.execute.mock.calls[0];
    expect(updateCall[0]).toContain("status = 'paid'");
    expect(updateCall[1]).toContain('pi_test_001');
  });

  it('idempotency — přeskočí duplicitní stripe_event_id', async () => {
    const rawBody = makeStripeEvent('payment_intent.succeeded', { id: 'pi_test_002' }, 'evt_duplicate');
    const sig = buildStripeSignature(rawBody, TEST_SECRET);

    // Simulovat existující event_id v payment_events
    const db = makeDb([[{ id: 'existing-pe-row' }]]);

    await expect(handleStripeWebhook(rawBody, sig, makeDeps(db))).rejects.toMatchObject({
      code: 'DUPLICATE_EVENT',
    });
    // Žádný UPDATE nesmí být volán
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('payment_intent.payment_failed → cancelled', async () => {
    const rawBody = makeStripeEvent('payment_intent.payment_failed', {
      id: 'pi_test_003',
    }, 'evt_failed_001');
    const sig = buildStripeSignature(rawBody, TEST_SECRET);

    const db = makeDb([
      [],                          // idempotency check → žádný duplicit
      undefined as unknown as unknown[],
      [{ id: 'order-uuid-003' }],
    ]);

    await handleStripeWebhook(rawBody, sig, makeDeps(db));

    const updateCall = db.execute.mock.calls[0];
    expect(updateCall[0]).toContain("status = 'cancelled'");
    expect(updateCall[1]).toContain('pi_test_003');
  });

  it('charge.dispute.created → chargeback', async () => {
    const rawBody = makeStripeEvent('charge.dispute.created', {
      id: 'dp_test_001',
      payment_intent: 'pi_test_004',
    }, 'evt_dispute_001');
    const sig = buildStripeSignature(rawBody, TEST_SECRET);

    const db = makeDb([
      [],
      undefined as unknown as unknown[],
      [{ id: 'order-uuid-004' }],
    ]);

    await handleStripeWebhook(rawBody, sig, makeDeps(db));

    const updateCall = db.execute.mock.calls[0];
    expect(updateCall[0]).toContain("status = 'chargeback'");
    expect(updateCall[1]).toContain('pi_test_004');
  });

  it('charge.refunded → refunded', async () => {
    const rawBody = makeStripeEvent('charge.refunded', {
      id: 'ch_test_001',
      payment_intent: 'pi_test_005',
    }, 'evt_refund_001');
    const sig = buildStripeSignature(rawBody, TEST_SECRET);

    const db = makeDb([
      [],
      undefined as unknown as unknown[],
      [{ id: 'order-uuid-005' }],
    ]);

    await handleStripeWebhook(rawBody, sig, makeDeps(db));

    const updateCall = db.execute.mock.calls[0];
    expect(updateCall[0]).toContain("status = 'refunded'");
    expect(updateCall[1]).toContain('pi_test_005');
  });

  it('hodí INVALID_WEBHOOK_SIGNATURE pro špatný podpis', async () => {
    const rawBody = makeStripeEvent('payment_intent.succeeded', { id: 'pi_test_bad' });
    const badSig = buildStripeSignature(rawBody, 'wrong_secret');

    const db = makeDb([]);

    await expect(handleStripeWebhook(rawBody, badSig, makeDeps(db))).rejects.toMatchObject({
      code: 'INVALID_WEBHOOK_SIGNATURE',
    });
  });
});

// =============================================================================
// 3. refundPayment
// =============================================================================

describe('refundPayment', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake_key_for_tests';
  });
  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
  });

  it('partial refund — volá Stripe API se správnou částkou', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 're_test_001', status: 'succeeded', amount: 10000 }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const db = makeDb([
      [{ id: 'order-uuid', status: 'paid', amount_hellers: 50000, stripe_payment_intent_id: 'pi_test_refund' }],
    ]);

    await refundPayment('order-uuid', 10000, 'requested_by_customer', makeDeps(db));

    // Ověřit že fetch byl volán s POST /v1/refunds
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.stripe.com/v1/refunds',
      expect.objectContaining({ method: 'POST' }),
    );

    const fetchCall = mockFetch.mock.calls[0][1];
    expect(fetchCall.body).toContain('amount=10000');
    expect(fetchCall.body).toContain('payment_intent=pi_test_refund');

    // Ověřit zápis do payment_events
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO orders.payment_events'),
      expect.arrayContaining(['order-uuid', 10000]),
    );

    vi.unstubAllGlobals();
  });

  it('hodí REFUND_EXCEEDS_AMOUNT pokud amountHellers > original', async () => {
    const db = makeDb([
      [{ id: 'order-uuid', status: 'paid', amount_hellers: 5000, stripe_payment_intent_id: 'pi_test_exc' }],
    ]);

    await expect(
      refundPayment('order-uuid', 9999, 'requested_by_customer', makeDeps(db)),
    ).rejects.toMatchObject({ code: 'REFUND_EXCEEDS_AMOUNT' });
  });

  it('hodí ORDER_NOT_FOUND pro neexistující objednávku', async () => {
    const db = makeDb([[]]); // prázdný výsledek
    await expect(
      refundPayment('nonexistent', 1000, 'duplicate', makeDeps(db)),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
  });

  it('hodí PAYMENT_INTENT_NOT_FOUND pokud stripe_payment_intent_id je null', async () => {
    const db = makeDb([
      [{ id: 'order-uuid', status: 'paid', amount_hellers: 5000, stripe_payment_intent_id: null }],
    ]);
    await expect(
      refundPayment('order-uuid', 1000, 'duplicate', makeDeps(db)),
    ).rejects.toMatchObject({ code: 'PAYMENT_INTENT_NOT_FOUND' });
  });
});

// =============================================================================
// 4. createPaymentIntent
// =============================================================================

describe('createPaymentIntent', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake_key_for_tests';
  });
  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    vi.unstubAllGlobals();
  });

  it('volá Stripe API se správnými parametry', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'pi_test_create_001',
        client_secret: 'pi_test_create_001_secret_abc',
        status: 'requires_payment_method',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const db = makeDb([
      [{ id: 'order-uuid', status: 'pending', amount_hellers: 25000 }],
    ]);

    const input: CreatePaymentIntentInput = {
      orderId: 'order-uuid',
      amountHellers: 25000,
      currency: 'CZK',
      metadata: { eventId: 'event-123' },
    };

    const result = await createPaymentIntent(input, makeDeps(db));

    expect(result.paymentIntentId).toBe('pi_test_create_001');
    expect(result.clientSecret).toBe('pi_test_create_001_secret_abc');
    expect(result.status).toBe('requires_payment_method');

    // Ověřit parametry fetch volání
    const fetchCall = mockFetch.mock.calls[0][1];
    expect(fetchCall.body).toContain('amount=25000');
    expect(fetchCall.body).toContain('currency=czk');
    expect(fetchCall.body).toContain('metadata%5Border_id%5D=order-uuid');
  });

  it('uloží stripe_payment_intent_id do DB', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'pi_test_save_001',
        client_secret: 'pi_test_save_001_secret',
        status: 'requires_payment_method',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const db = makeDb([
      [{ id: 'order-uuid-save', status: 'pending', amount_hellers: 10000 }],
    ]);

    await createPaymentIntent(
      { orderId: 'order-uuid-save', amountHellers: 10000, currency: 'czk' },
      makeDeps(db),
    );

    // Ověřit UPDATE orders — uloží payment_intent_id
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE orders.orders'),
      expect.arrayContaining(['pi_test_save_001', 'order-uuid-save']),
    );

    // Ověřit INSERT do payment_events
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO orders.payment_events'),
      expect.arrayContaining(['order-uuid-save', 10000]),
    );
  });

  it('hodí ORDER_NOT_FOUND pro neexistující objednávku', async () => {
    const db = makeDb([[]]); // prázdný výsledek
    await expect(
      createPaymentIntent({ orderId: 'nonexistent', amountHellers: 1000, currency: 'czk' }, makeDeps(db)),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
  });

  it('hodí ALREADY_PAID pro již zaplacenou objednávku', async () => {
    const db = makeDb([
      [{ id: 'order-uuid', status: 'paid', amount_hellers: 10000 }],
    ]);
    await expect(
      createPaymentIntent({ orderId: 'order-uuid', amountHellers: 10000, currency: 'czk' }, makeDeps(db)),
    ).rejects.toMatchObject({ code: 'ALREADY_PAID' });
  });

  it('hodí STRIPE_API_ERROR při chybě Stripe API', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        error: { message: 'Your card was declined.', type: 'card_error', code: 'card_declined' },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const db = makeDb([
      [{ id: 'order-uuid', status: 'pending', amount_hellers: 10000 }],
    ]);

    await expect(
      createPaymentIntent({ orderId: 'order-uuid', amountHellers: 10000, currency: 'czk' }, makeDeps(db)),
    ).rejects.toMatchObject({ code: 'STRIPE_API_ERROR' });
  });
});

// =============================================================================
// 5. StripeError — chybová třída
// =============================================================================

describe('StripeError', () => {
  it('má správný statusCode pro ORDER_NOT_FOUND', () => {
    const err = new StripeError('ORDER_NOT_FOUND');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('ORDER_NOT_FOUND');
  });

  it('má správný statusCode pro ALREADY_PAID', () => {
    expect(new StripeError('ALREADY_PAID').statusCode).toBe(409);
  });

  it('má správný statusCode pro INVALID_WEBHOOK_SIGNATURE', () => {
    expect(new StripeError('INVALID_WEBHOOK_SIGNATURE').statusCode).toBe(401);
  });

  it('má správný statusCode pro REFUND_EXCEEDS_AMOUNT', () => {
    expect(new StripeError('REFUND_EXCEEDS_AMOUNT').statusCode).toBe(422);
  });

  it('má správný statusCode pro STRIPE_API_ERROR', () => {
    expect(new StripeError('STRIPE_API_ERROR').statusCode).toBe(502);
  });

  it('má správný statusCode pro DUPLICATE_EVENT', () => {
    expect(new StripeError('DUPLICATE_EVENT').statusCode).toBe(200);
  });

  it('toHttpError vrátí správný tvar', () => {
    const http = new StripeError('ORDER_NOT_FOUND').toHttpError();
    expect(http).toMatchObject({ error: 'ORDER_NOT_FOUND', statusCode: 404 });
    expect(typeof http.message).toBe('string');
  });

  it('přijímá vlastní zprávu', () => {
    const err = new StripeError('STRIPE_API_ERROR', 'Custom Stripe error message');
    expect(err.message).toBe('Custom Stripe error message');
  });
});
