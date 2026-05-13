// =============================================================================
// Testy pro gopay-payment.service
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createGopayPayment,
  getGopayPayment,
  handleGopayWebhook,
  refundGopayPayment,
} from '../services/gopay-payment.service.js';
import { GopayHttpClient } from '../lib/gopay-client.js';
import { __resetGopayConfigWarning, type GopayConfig } from '../lib/gopay-config.js';
import type { ServiceDeps, KafkaProducerAdapter } from '../lib/service-container.js';
import type { DbAdapter } from '@tixly/db-adapter';
import type { GopayCreatePaymentInput } from '../types/gopay.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<GopayConfig> = {}): GopayConfig {
  return {
    goid: 123456,
    clientId: 'test-client',
    clientSecret: 'test-secret',
    apiBaseUrl: 'https://gate.gopay.cz/api',
    notificationUrl: 'https://example.com/webhook',
    returnUrl: 'https://example.com/return',
    isConfigured: true,
    ...overrides,
  };
}

function makeDevConfig(): GopayConfig {
  return makeConfig({
    isConfigured: false,
    goid: 0,
    clientId: '',
    clientSecret: '',
    notificationUrl: '',
    returnUrl: '',
  });
}

function makeMockDb(): DbAdapter & {
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
} {
  const db = {
    query: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(async (fn: (tx: DbAdapter) => Promise<unknown>) => fn(db as unknown as DbAdapter)),
  };
  return db as unknown as DbAdapter & {
    query: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
    transaction: ReturnType<typeof vi.fn>;
  };
}

function makeMockKafka(): KafkaProducerAdapter & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn().mockResolvedValue(undefined) };
}

function makeDeps(config: GopayConfig) {
  const db = makeMockDb();
  const kafka = makeMockKafka();
  const gopay = new GopayHttpClient(config);
  const deps: ServiceDeps = { db, kafka, gopay, config };
  return { deps, db, kafka, gopay };
}

const baseInput: GopayCreatePaymentInput = {
  orderId: 'order-1',
  amountHalire: 50000,
  currency: 'CZK',
  description: 'Test order',
  buyerEmail: 'buyer@example.com',
  buyerFirstName: 'Jan',
  buyerLastName: 'Novák',
  items: [{ name: 'Ticket', amountHalire: 50000, count: 1 }],
};

const baseRow = {
  id: 'uuid-1',
  order_id: 'order-1',
  external_payment_id: 'gp-ext-1',
  amount_halire: 50000,
  currency: 'CZK',
  status: 'CREATED',
  payment_instrument: null,
  gateway_url: 'https://gate.gopay.cz/gw/1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  __resetGopayConfigWarning();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// createGopayPayment — DEV stub režim
// ---------------------------------------------------------------------------
describe('createGopayPayment (dev stub)', () => {
  it('vrátí stub URL a nevolá fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const { deps, db } = makeDeps(makeDevConfig());

    db.query.mockResolvedValueOnce([{ ...baseRow, external_payment_id: 'dev-xxx', gateway_url: '/dev/gopay-stub' }]);

    const payment = await createGopayPayment(baseInput, deps);

    expect(payment.gatewayUrl).toBe('/dev/gopay-stub');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createGopayPayment — configured režim, ověření payloadu
// ---------------------------------------------------------------------------
describe('createGopayPayment (configured)', () => {
  it('sestaví správný GoPay payload s goid, items a callbackem', async () => {
    const { deps, db } = makeDeps(makeConfig());

    const tokenResponse = new Response(
      JSON.stringify({ access_token: 'tok-1', expires_in: 1800 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
    const createResponse = new Response(
      JSON.stringify({ id: 'gp-ext-1', gw_url: 'https://gate.gopay.cz/gw/1', state: 'CREATED' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(tokenResponse)
      .mockResolvedValueOnce(createResponse);

    db.query.mockResolvedValueOnce([baseRow]);

    await createGopayPayment(baseInput, deps);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const createCall = fetchSpy.mock.calls[1]!;
    expect(createCall[0]).toBe('https://gate.gopay.cz/api/payments/payment');
    const body = JSON.parse((createCall[1] as RequestInit).body as string);

    expect(body.amount).toBe(50000);
    expect(body.currency).toBe('CZK');
    expect(body.order_number).toBe('order-1');
    expect(body.target).toEqual({ type: 'ACCOUNT', goid: 123456 });
    expect(body.callback.notification_url).toBe('https://example.com/webhook');
    expect(body.callback.return_url).toBe('https://example.com/return');
    expect(body.payer.contact.email).toBe('buyer@example.com');
    expect(body.items).toEqual([{ name: 'Ticket', amount: 50000, count: 1 }]);
    expect(body.lang).toBe('CS');
  });
});

// ---------------------------------------------------------------------------
// handleGopayWebhook — anti-spoofing (re-fetch)
// ---------------------------------------------------------------------------
describe('handleGopayWebhook', () => {
  it('re-fetchuje stav přes getPayment a aktualizuje DB + Kafka + orders.orders', async () => {
    const { deps, db, kafka, gopay } = makeDeps(makeConfig());

    // 1. lookup row v payments.gopay_payments
    // 2. RETURNING id z UPDATE orders.orders (1 řádek)
    db.query
      .mockResolvedValueOnce([baseRow])
      .mockResolvedValueOnce([{ id: 'order-1' }]);

    const getPaymentSpy = vi
      .spyOn(gopay, 'getPayment')
      .mockResolvedValue({
        id: 'gp-ext-1',
        state: 'PAID',
        amount: 50000,
        currency: 'CZK',
        payment_instrument: 'PAYMENT_CARD',
      });

    const result = await handleGopayWebhook(
      { id: 'gp-ext-1', orderNumber: 'order-1', status: 'CREATED' },
      deps,
    );

    expect(getPaymentSpy).toHaveBeenCalledWith('gp-ext-1');
    expect(result.statusUpdated).toBe(true);
    expect(result.newStatus).toBe('PAID');
    expect(db.execute).toHaveBeenCalled();

    // Ověříme, že jsme updatovali orders.orders se správnými parametry
    const orderUpdateCall = db.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('UPDATE orders.orders'),
    );
    expect(orderUpdateCall).toBeDefined();
    expect(orderUpdateCall![0]).toContain("status = 'paid'");
    expect(orderUpdateCall![0]).toContain("status IN ('pending', 'awaiting_payment')");
    expect(orderUpdateCall![1]).toEqual(['order-1']);

    expect(kafka.send).toHaveBeenCalledWith(
      'gopay.payment.paid',
      expect.objectContaining({ newStatus: 'PAID', previousStatus: 'CREATED' }),
    );
  });

  it('je idempotentní — druhé volání webhooku neudělá druhý paid-update', async () => {
    const { deps, db, gopay } = makeDeps(makeConfig());

    // 1. lookup — row už má status PAID (první webhook prošel)
    // 2. RETURNING id z UPDATE orders.orders — žádný řádek (idempotence)
    db.query
      .mockResolvedValueOnce([{ ...baseRow, status: 'PAID' }])
      .mockResolvedValueOnce([]);

    vi.spyOn(gopay, 'getPayment').mockResolvedValue({
      id: 'gp-ext-1',
      state: 'PAID',
      amount: 50000,
      currency: 'CZK',
      payment_instrument: 'PAYMENT_CARD',
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await handleGopayWebhook(
      { id: 'gp-ext-1', orderNumber: 'order-1', status: 'PAID' },
      deps,
    );

    // Status se nezměnil, ale update orders.orders se pokusí provést kvůli možnému nesouladu.
    // Klíčové: RETURNING vrátí 0 řádků → varování, žádný throw.
    expect(result.newStatus).toBe('PAID');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('již byla zaplacena nebo není ve stavu pending'),
    );
  });

  it('neznámá platba (external_payment_id neexistuje) → GOPAY_PAYMENT_NOT_FOUND', async () => {
    const { deps, db, gopay } = makeDeps(makeConfig());

    db.query.mockResolvedValueOnce([]);
    vi.spyOn(gopay, 'getPayment').mockResolvedValue({
      id: 'gp-ext-unknown',
      state: 'PAID',
      amount: 50000,
      currency: 'CZK',
    });

    await expect(
      handleGopayWebhook({ id: 'gp-ext-unknown', orderNumber: 'x', status: 'PAID' }, deps),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// refundGopayPayment — happy path
// ---------------------------------------------------------------------------
describe('refundGopayPayment', () => {
  it('zavolá refundPayment a aktualizuje status', async () => {
    const { deps, db, kafka, gopay } = makeDeps(makeConfig());

    db.query.mockResolvedValueOnce([baseRow]);
    const refundSpy = vi.spyOn(gopay, 'refundPayment').mockResolvedValue({ result: 'FINISHED' });

    const result = await refundGopayPayment('uuid-1', 50000, deps);

    expect(refundSpy).toHaveBeenCalledWith('gp-ext-1', 50000);
    expect(result.refunded).toBe(true);
    expect(db.execute).toHaveBeenCalled();
    expect(kafka.send).toHaveBeenCalledWith('gopay.payment.refunded', expect.any(Object));
  });

  it('odmítne refund přesahující částku', async () => {
    const { deps, db } = makeDeps(makeConfig());
    db.query.mockResolvedValueOnce([baseRow]);

    await expect(refundGopayPayment('uuid-1', 99999, deps)).rejects.toThrow(/přesahuje/);
  });
});

// ---------------------------------------------------------------------------
// getGopayPayment — refreshne stav
// ---------------------------------------------------------------------------
describe('getGopayPayment', () => {
  it('načte z DB, re-fetchne stav a updatuje pokud se liší', async () => {
    const { deps, db, gopay } = makeDeps(makeConfig());
    db.query
      .mockResolvedValueOnce([baseRow])
      .mockResolvedValueOnce([{ ...baseRow, status: 'PAID' }]);

    vi.spyOn(gopay, 'getPayment').mockResolvedValue({
      id: 'gp-ext-1',
      state: 'PAID',
      amount: 50000,
      currency: 'CZK',
    });

    const p = await getGopayPayment('uuid-1', deps);
    expect(p.status).toBe('PAID');
  });
});

// ---------------------------------------------------------------------------
// handleGopayWebhook — CANCELED / TIMEOUTED flow
// ---------------------------------------------------------------------------
describe('handleGopayWebhook — CANCELED flow', () => {
  it('CANCELED → order cancelled + Kafka gopay.payment.failed', async () => {
    const { deps, db, kafka, gopay } = makeDeps(makeConfig());

    // SELECT gopay_payment by external_payment_id
    db.query.mockResolvedValueOnce([baseRow]);

    vi.spyOn(gopay, 'getPayment').mockResolvedValue({
      id: 'gp-ext-1',
      state: 'CANCELED',
      amount: 50000,
      currency: 'CZK',
    });

    const result = await handleGopayWebhook(
      { id: 'gp-ext-1', orderNumber: 'order-1', status: 'CREATED' },
      deps,
    );

    expect(result.newStatus).toBe('CANCELED');
    expect(result.statusUpdated).toBe(true);

    // UPDATE orders.orders status = 'cancelled' must have been called
    const cancelExec = (db.execute.mock.calls as [string, unknown[]][]).find(
      ([sql]) => sql.includes("status = 'cancelled'"),
    );
    expect(cancelExec).toBeDefined();

    expect(kafka.send).toHaveBeenCalledWith(
      'gopay.payment.failed',
      expect.objectContaining({ newStatus: 'CANCELED' }),
    );
  });

  it('TIMEOUTED → order cancelled + Kafka gopay.payment.failed', async () => {
    const { deps, db, kafka, gopay } = makeDeps(makeConfig());
    db.query.mockResolvedValueOnce([baseRow]);
    vi.spyOn(gopay, 'getPayment').mockResolvedValue({
      id: 'gp-ext-1',
      state: 'TIMEOUTED',
      amount: 50000,
      currency: 'CZK',
    });

    const result = await handleGopayWebhook(
      { id: 'gp-ext-1', orderNumber: 'order-1', status: 'CREATED' },
      deps,
    );

    expect(result.newStatus).toBe('TIMEOUTED');
    expect(kafka.send).toHaveBeenCalledWith('gopay.payment.failed', expect.any(Object));
  });
});

// ---------------------------------------------------------------------------
// handleGopayWebhook — REFUNDED flow
// ---------------------------------------------------------------------------
describe('handleGopayWebhook — REFUNDED flow', () => {
  it('REFUNDED → order refunded + Kafka gopay.payment.refunded', async () => {
    const { deps, db, kafka, gopay } = makeDeps(makeConfig());

    // Row is already PAID (normal pre-refund state)
    db.query.mockResolvedValueOnce([{ ...baseRow, status: 'PAID' }]);

    vi.spyOn(gopay, 'getPayment').mockResolvedValue({
      id: 'gp-ext-1',
      state: 'REFUNDED',
      amount: 50000,
      currency: 'CZK',
    });

    const result = await handleGopayWebhook(
      { id: 'gp-ext-1', orderNumber: 'order-1', status: 'PAID' },
      deps,
    );

    expect(result.newStatus).toBe('REFUNDED');
    expect(result.statusUpdated).toBe(true);

    const refundExec = (db.execute.mock.calls as [string, unknown[]][]).find(
      ([sql]) => sql.includes("status = 'refunded'"),
    );
    expect(refundExec).toBeDefined();

    expect(kafka.send).toHaveBeenCalledWith(
      'gopay.payment.refunded',
      expect.objectContaining({ newStatus: 'REFUNDED' }),
    );
  });
});

// ---------------------------------------------------------------------------
// handleGopayWebhook — guard: prázdné id vyhodí chybu
// ---------------------------------------------------------------------------
describe('handleGopayWebhook — invalid payload', () => {
  it('vyhodí GOPAY_INVALID_WEBHOOK když payload.id je prázdné', async () => {
    const { deps } = makeDeps(makeConfig());
    await expect(
      handleGopayWebhook({ id: '', orderNumber: '', status: 'CREATED' }, deps),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// refundGopayPayment — A14: query používá interní UUID (bez OR external_payment_id)
// ---------------------------------------------------------------------------
describe('refundGopayPayment — A14 oprava', () => {
  it('SQL dotaz pro vyhledání platby používá pouze WHERE id = $1 (žádný OR external_payment_id)', async () => {
    const { deps, db, gopay } = makeDeps(makeConfig());
    db.query.mockResolvedValueOnce([baseRow]);
    vi.spyOn(gopay, 'refundPayment').mockResolvedValue({ result: 'FINISHED' });

    await refundGopayPayment('uuid-1', 1000, deps);

    // První query call je SELECT lookup — ověříme SQL
    const lookupSql = (db.query.mock.calls[0] as [string, unknown[]])[0];
    expect(lookupSql).toContain('WHERE id = $1');
    expect(lookupSql).not.toContain('external_payment_id');
  });

  it('výsledek ACCEPTED z GoPay je považován za úspěšný refund', async () => {
    const { deps, db, kafka, gopay } = makeDeps(makeConfig());
    db.query.mockResolvedValueOnce([baseRow]);
    vi.spyOn(gopay, 'refundPayment').mockResolvedValue({ result: 'ACCEPTED' });

    const result = await refundGopayPayment('uuid-1', 1000, deps);

    expect(result.refunded).toBe(true);
    expect(kafka.send).toHaveBeenCalledWith('gopay.payment.refunded', expect.any(Object));
  });

  it('výsledek jiný než FINISHED/ACCEPTED → refunded = false, žádný Kafka event', async () => {
    const { deps, db, kafka, gopay } = makeDeps(makeConfig());
    db.query.mockResolvedValueOnce([baseRow]);
    vi.spyOn(gopay, 'refundPayment').mockResolvedValue({ result: 'FAILED' as 'FINISHED' });

    const result = await refundGopayPayment('uuid-1', 1000, deps);

    expect(result.refunded).toBe(false);
    expect(kafka.send).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// A1 — GoPay webhook order paid flow (BUG-001 fix coverage)
// ---------------------------------------------------------------------------
describe('handleGopayWebhook — A1: PAID flow', () => {
  it('A1-1: PAID state → UPDATE orders.orders SET status = "paid" je voláno', async () => {
    const { deps, db, gopay } = makeDeps(makeConfig());

    db.query
      .mockResolvedValueOnce([baseRow])              // SELECT gopay_payment
      .mockResolvedValueOnce([{ id: 'order-1' }]);  // RETURNING id z UPDATE orders

    vi.spyOn(gopay, 'getPayment').mockResolvedValue({
      id: 'gp-ext-1',
      state: 'PAID',
      amount: 50000,
      currency: 'CZK',
      payment_instrument: 'PAYMENT_CARD',
    });

    // Suppress fire-and-forget fetch error (INTERNAL_API_BASE_URL not set in tests)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

    await handleGopayWebhook(
      { id: 'gp-ext-1', orderNumber: 'order-1', status: 'CREATED' },
      deps,
    );

    // Ověř, že byl zavolán UPDATE orders.orders SET status = 'paid'
    const paidUpdateCall = db.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes("status = 'paid'"),
    );
    expect(paidUpdateCall).toBeDefined();
    expect((paidUpdateCall![0] as string)).toContain("status IN ('pending', 'awaiting_payment')");
    expect(paidUpdateCall![1]).toEqual(['order-1']);

    fetchSpy.mockRestore();
  });

  it('A1-2: PAID state → fire-and-forget fetch na /api/internal/order-completed s orderId', async () => {
    process.env.INTERNAL_API_BASE_URL = 'http://localhost:3000';
    process.env.INTERNAL_SERVICE_TOKEN = 'test-token';

    const { deps, db, gopay } = makeDeps(makeConfig());

    db.query
      .mockResolvedValueOnce([baseRow])
      .mockResolvedValueOnce([{ id: 'order-1' }]);

    vi.spyOn(gopay, 'getPayment').mockResolvedValue({
      id: 'gp-ext-1',
      state: 'PAID',
      amount: 50000,
      currency: 'CZK',
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

    await handleGopayWebhook(
      { id: 'gp-ext-1', orderNumber: 'order-1', status: 'CREATED' },
      deps,
    );

    // Dej fire-and-forget čas na spuštění (je synchronně spuštěn, ale Promise je void)
    await new Promise((r) => setTimeout(r, 0));

    // Ověř, že fetch byl zavolán na order-completed endpoint
    const orderCompletedCall = fetchSpy.mock.calls.find(
      ([url]) => typeof url === 'string' && (url as string).includes('/api/internal/order-completed'),
    );
    expect(orderCompletedCall).toBeDefined();
    const [url, init] = orderCompletedCall!;
    expect(url).toBe('http://localhost:3000/api/internal/order-completed');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse((init as RequestInit).body as string) as { orderId: string };
    expect(body.orderId).toBe('order-1');

    delete process.env.INTERNAL_API_BASE_URL;
    delete process.env.INTERNAL_SERVICE_TOKEN;
    fetchSpy.mockRestore();
  });

  it('A1-3: PAID state → handleGopayWebhook vrátí { statusUpdated: true, newStatus: "PAID" }', async () => {
    const { deps, db, gopay } = makeDeps(makeConfig());

    db.query
      .mockResolvedValueOnce([baseRow])
      .mockResolvedValueOnce([{ id: 'order-1' }]);

    vi.spyOn(gopay, 'getPayment').mockResolvedValue({
      id: 'gp-ext-1',
      state: 'PAID',
      amount: 50000,
      currency: 'CZK',
    });

    // Suppress fire-and-forget fetch error
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

    const result = await handleGopayWebhook(
      { id: 'gp-ext-1', orderNumber: 'order-1', status: 'CREATED' },
      deps,
    );

    expect(result).toEqual({ statusUpdated: true, newStatus: 'PAID' });
    fetchSpy.mockRestore();
  });

  it('A1-4: CANCELED state → UPDATE orders.orders SET status = "cancelled"', async () => {
    const { deps, db, gopay } = makeDeps(makeConfig());

    db.query.mockResolvedValueOnce([baseRow]); // SELECT gopay_payment

    vi.spyOn(gopay, 'getPayment').mockResolvedValue({
      id: 'gp-ext-1',
      state: 'CANCELED',
      amount: 50000,
      currency: 'CZK',
    });

    const result = await handleGopayWebhook(
      { id: 'gp-ext-1', orderNumber: 'order-1', status: 'CREATED' },
      deps,
    );

    expect(result.newStatus).toBe('CANCELED');
    expect(result.statusUpdated).toBe(true);

    // Ověř UPDATE orders.orders SET status = 'cancelled'
    const cancelledExec = (db.execute.mock.calls as [string, unknown[]][]).find(
      ([sql]) => sql.includes("status = 'cancelled'") && sql.includes('orders.orders'),
    );
    expect(cancelledExec).toBeDefined();
    expect(cancelledExec![1]).toEqual(['order-1']);
  });

  it('A1-5: TIMEOUTED state → UPDATE orders.orders SET status = "cancelled"', async () => {
    const { deps, db, gopay } = makeDeps(makeConfig());

    db.query.mockResolvedValueOnce([baseRow]); // SELECT gopay_payment

    vi.spyOn(gopay, 'getPayment').mockResolvedValue({
      id: 'gp-ext-1',
      state: 'TIMEOUTED',
      amount: 50000,
      currency: 'CZK',
    });

    const result = await handleGopayWebhook(
      { id: 'gp-ext-1', orderNumber: 'order-1', status: 'CREATED' },
      deps,
    );

    expect(result.newStatus).toBe('TIMEOUTED');
    expect(result.statusUpdated).toBe(true);

    // Ověř UPDATE orders.orders SET status = 'cancelled' (TIMEOUTED i CANCELED → 'cancelled')
    const cancelledExec = (db.execute.mock.calls as [string, unknown[]][]).find(
      ([sql]) => sql.includes("status = 'cancelled'") && sql.includes('orders.orders'),
    );
    expect(cancelledExec).toBeDefined();
    expect(cancelledExec![1]).toEqual(['order-1']);
  });
});

// ---------------------------------------------------------------------------
// Token caching
// ---------------------------------------------------------------------------
describe('GopayHttpClient token caching', () => {
  it('druhé volání v rámci validity znovu nežádá token', async () => {
    const client = new GopayHttpClient(makeConfig());

    const tokenResponse = () =>
      new Response(JSON.stringify({ access_token: 'tok-1', expires_in: 1800 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => tokenResponse());

    const t1 = await client.getAccessToken();
    const t2 = await client.getAccessToken();

    expect(t1).toBe('tok-1');
    expect(t2).toBe('tok-1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
