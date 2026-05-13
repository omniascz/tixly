import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createTransaction,
  handleWebhook,
  getTransaction,
  refundPayment,
  signTransaction,
  signWebhook,
} from '../services/przelewy24.service.js';
import type { P24Config, P24WebhookPayload, DbAdapter, HttpClient } from '../lib/types.js';
import { P24SignatureError, P24TransactionNotFoundError, P24Error } from '../lib/types.js';
import { createHash } from 'crypto';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SESSION_ID = 'order-pl-001';
const AMOUNT = 9990; // 99.90 PLN v groszích
const TOKEN = 'p24-token-abc';
const P24_ORDER_ID = 12345;

const config: P24Config = {
  merchantId: 100001,
  posId: 100001,
  apiKey: 'test-api-key',
  reportKey: 'test-report-key',
  sandbox: true,
  returnUrl: 'https://tixly.pl/order/thank-you',
  notifyUrl: 'https://tixly.pl/api/payments/przelewy24/notify',
};

function makeTransactionRow(overrides: Record<string, unknown> = {}) {
  return {
    session_id: SESSION_ID,
    token: TOKEN,
    redirect_url: `https://sandbox.przelewy24.pl/trnRequest/${TOKEN}`,
    amount: AMOUNT,
    currency: 'PLN',
    status: 'pending',
    p24_order_id: null,
    created_at: '2026-04-21T10:00:00Z',
    ...overrides,
  };
}

function makeDb(queryResults: unknown[][] = []): DbAdapter {
  let callIdx = 0;

  const queryFn = vi.fn(async () => {
    const result = queryResults[callIdx] ?? [];
    callIdx++;
    return result;
  });

  const executeFn = vi.fn();

  function makeAdapter(): DbAdapter {
    return {
      query: queryFn,
      execute: executeFn,
      transaction: vi.fn(async (fn) => fn(makeAdapter())),
    };
  }

  return makeAdapter();
}

function makeHttp(): HttpClient {
  return {
    post: vi.fn(),
    put: vi.fn(),
    get: vi.fn(),
  };
}

// ─── signTransaction ─────────────────────────────────────────────────────────

describe('signTransaction', () => {
  it('returns SHA384 hex of JSON payload', () => {
    const sign = signTransaction('sess-1', 100001, 9990, 'PLN', 'crc-key');
    const expected = createHash('sha384')
      .update(JSON.stringify({ sessionId: 'sess-1', merchantId: 100001, amount: 9990, currency: 'PLN', crc: 'crc-key' }))
      .digest('hex');
    expect(sign).toBe(expected);
  });

  it('differs when amount changes', () => {
    const s1 = signTransaction('sess-1', 100001, 9990, 'PLN', 'crc-key');
    const s2 = signTransaction('sess-1', 100001, 5000, 'PLN', 'crc-key');
    expect(s1).not.toBe(s2);
  });
});

// ─── signWebhook ─────────────────────────────────────────────────────────────

describe('signWebhook', () => {
  it('returns SHA384 hex over all webhook fields', () => {
    const payload: P24WebhookPayload = {
      merchantId: 100001,
      posId: 100001,
      sessionId: SESSION_ID,
      amount: AMOUNT,
      originAmount: AMOUNT,
      currency: 'PLN',
      orderId: P24_ORDER_ID,
      methodId: 154,
      statement: 'Tixly order',
      sign: '',
    };
    const sign = signWebhook(payload, 'crc-key');
    const expected = createHash('sha384')
      .update(JSON.stringify({
        merchantId: 100001,
        posId: 100001,
        sessionId: SESSION_ID,
        amount: AMOUNT,
        originAmount: AMOUNT,
        currency: 'PLN',
        orderId: P24_ORDER_ID,
        methodId: 154,
        statement: 'Tixly order',
        crc: 'crc-key',
      }))
      .digest('hex');
    expect(sign).toBe(expected);
  });
});

// ─── createTransaction ────────────────────────────────────────────────────────

describe('createTransaction', () => {
  it('registers transaction, stores in DB and returns redirect URL', async () => {
    const db = makeDb([[makeTransactionRow()]]);
    const http = makeHttp();
    (http.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { token: TOKEN },
    });

    const tx = await createTransaction(SESSION_ID, AMOUNT, 'Rock Festival', 'jan@example.pl', config, db, http);

    expect(tx.token).toBe(TOKEN);
    expect(tx.redirectUrl).toContain(TOKEN);
    expect(tx.status).toBe('pending');
    expect(tx.amount).toBe(AMOUNT);
    expect(tx.currency).toBe('PLN');
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO przelewy24.transactions'),
      expect.arrayContaining([SESSION_ID, TOKEN]),
    );
  });

  it('sends correct payload with signature to P24 API', async () => {
    const db = makeDb([[makeTransactionRow()]]);
    const http = makeHttp();
    (http.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: { token: TOKEN } });

    await createTransaction(SESSION_ID, AMOUNT, 'Test', 'test@test.pl', config, db, http);

    const body = (http.post as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<string, unknown>;
    expect(body.merchantId).toBe(config.merchantId);
    expect(body.amount).toBe(AMOUNT);
    expect(body.currency).toBe('PLN');
    expect(typeof body.sign).toBe('string');
    expect((body.sign as string).length).toBe(96); // SHA384 hex = 96 chars
  });

  it('uses sandbox API base when sandbox=true', async () => {
    const db = makeDb([[makeTransactionRow()]]);
    const http = makeHttp();
    (http.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: { token: TOKEN } });

    await createTransaction(SESSION_ID, AMOUNT, 'Test', 'test@test.pl', config, db, http);

    const url = (http.post as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('sandbox.przelewy24.pl');
  });

  it('uses production API base when sandbox=false', async () => {
    const prodConfig = { ...config, sandbox: false };
    const db = makeDb([[makeTransactionRow()]]);
    const http = makeHttp();
    (http.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: { token: TOKEN } });

    await createTransaction(SESSION_ID, AMOUNT, 'Test', 'test@test.pl', prodConfig, db, http);

    const url = (http.post as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('secure.przelewy24.pl');
    expect(url).not.toContain('sandbox');
  });

  it('sends Basic Auth header', async () => {
    const db = makeDb([[makeTransactionRow()]]);
    const http = makeHttp();
    (http.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: { token: TOKEN } });

    await createTransaction(SESSION_ID, AMOUNT, 'Test', 'test@test.pl', config, db, http);

    const headers = (http.post as ReturnType<typeof vi.fn>).mock.calls[0][2] as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Basic /);
  });
});

// ─── handleWebhook ────────────────────────────────────────────────────────────

function makeValidWebhookPayload(): P24WebhookPayload {
  const partial: Omit<P24WebhookPayload, 'sign'> = {
    merchantId: config.merchantId,
    posId: config.posId,
    sessionId: SESSION_ID,
    amount: AMOUNT,
    originAmount: AMOUNT,
    currency: 'PLN',
    orderId: P24_ORDER_ID,
    methodId: 154,
    statement: 'Tixly order',
  };
  const sign = signWebhook({ ...partial, sign: '' }, config.reportKey);
  return { ...partial, sign };
}

describe('handleWebhook', () => {
  it('verifies signature, calls P24 verify, marks transaction completed', async () => {
    const payload = makeValidWebhookPayload();
    const db = makeDb([[makeTransactionRow({ status: 'completed', p24_order_id: String(P24_ORDER_ID) })]]);
    const http = makeHttp();
    (http.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: { status: 'success' } });

    const tx = await handleWebhook(payload, config, db, http);

    expect(tx.status).toBe('completed');
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE przelewy24.transactions'),
      expect.arrayContaining(['completed']),
    );
  });

  it('throws P24SignatureError when sign is wrong', async () => {
    const payload = { ...makeValidWebhookPayload(), sign: 'bad-signature' };
    const db = makeDb();
    const http = makeHttp();

    await expect(handleWebhook(payload, config, db, http)).rejects.toThrow(P24SignatureError);
  });

  it('marks transaction failed when P24 verify returns non-success', async () => {
    const payload = makeValidWebhookPayload();
    const db = makeDb([[makeTransactionRow({ status: 'failed', p24_order_id: String(P24_ORDER_ID) })]]);
    const http = makeHttp();
    (http.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: { status: 'error' } });

    await expect(handleWebhook(payload, config, db, http)).rejects.toThrow('payment failed');
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE przelewy24.transactions'),
      expect.arrayContaining(['failed']),
    );
  });

  it('throws NOT_FOUND when transaction row missing after update', async () => {
    const payload = makeValidWebhookPayload();
    const db = makeDb([[]]); // empty result
    const http = makeHttp();
    (http.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: { status: 'success' } });

    await expect(handleWebhook(payload, config, db, http)).rejects.toThrow(P24TransactionNotFoundError);
  });
});

// ─── getTransaction ───────────────────────────────────────────────────────────

describe('getTransaction', () => {
  it('returns transaction from DB', async () => {
    const db = makeDb([[makeTransactionRow({ status: 'completed' })]]);
    const tx = await getTransaction(SESSION_ID, db);
    expect(tx.sessionId).toBe(SESSION_ID);
    expect(tx.status).toBe('completed');
  });

  it('throws P24TransactionNotFoundError when missing', async () => {
    const db = makeDb([[]]);
    await expect(getTransaction('missing', db)).rejects.toThrow(P24TransactionNotFoundError);
  });
});

// ─── refundPayment ────────────────────────────────────────────────────────────

describe('refundPayment', () => {
  it('refunds full amount when amountGrosze is null', async () => {
    const db = makeDb([[makeTransactionRow({ status: 'completed', p24_order_id: String(P24_ORDER_ID) })]]);
    const http = makeHttp();
    (http.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { refundId: 'refund-1', amount: AMOUNT },
    });

    const result = await refundPayment(SESSION_ID, null, config, db, http);

    expect(result.refundId).toBe('refund-1');
    expect(result.amount).toBe(AMOUNT);

    const refundBody = (http.post as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<string, unknown>;
    const refunds = refundBody.refunds as Array<{ amount: number }>;
    expect(refunds[0].amount).toBe(AMOUNT);
  });

  it('refunds partial amount', async () => {
    const db = makeDb([[makeTransactionRow({ status: 'completed', p24_order_id: String(P24_ORDER_ID) })]]);
    const http = makeHttp();
    (http.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { refundId: 'refund-2', amount: 5000 },
    });

    await refundPayment(SESSION_ID, 5000, config, db, http);

    const refundBody = (http.post as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<string, unknown>;
    const refunds = refundBody.refunds as Array<{ amount: number }>;
    expect(refunds[0].amount).toBe(5000);
  });

  it('marks transaction as refunded in DB', async () => {
    const db = makeDb([[makeTransactionRow({ status: 'completed', p24_order_id: String(P24_ORDER_ID) })]]);
    const http = makeHttp();
    (http.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { refundId: 'refund-3', amount: AMOUNT },
    });

    await refundPayment(SESSION_ID, null, config, db, http);

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'refunded'"),
      expect.arrayContaining([SESSION_ID]),
    );
  });

  it('throws P24Error when transaction is not completed', async () => {
    const db = makeDb([[makeTransactionRow({ status: 'pending' })]]);
    const http = makeHttp();

    await expect(refundPayment(SESSION_ID, null, config, db, http)).rejects.toThrow(P24Error);
  });

  it('throws P24TransactionNotFoundError when session not found', async () => {
    const db = makeDb([[]]);
    const http = makeHttp();

    await expect(refundPayment('missing', null, config, db, http)).rejects.toThrow(P24TransactionNotFoundError);
  });
});
