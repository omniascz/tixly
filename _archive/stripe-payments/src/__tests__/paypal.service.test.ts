import { describe, it, expect, vi } from 'vitest';
import {
  createPayPalOrder,
  capturePayPalOrder,
  refundPayPalOrder,
  getPayPalOrder,
} from '../services/paypal.service.js';
import type { DbAdapter, PayPalAdapter } from '../services/paypal.service.js';

function makeOrderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pp-001',
    order_id: 'order-001',
    user_id: 'user-001',
    paypal_order_id: 'PP_ORDER_ABC',
    amount_hellers: '200000',
    currency: 'CZK',
    status: 'created',
    paypal_capture_id: null,
    payer_email: null,
    payer_name: null,
    error_code: null,
    error_message: null,
    created_at: '2026-04-14T10:00:00Z',
    updated_at: '2026-04-14T10:00:00Z',
    captured_at: null,
    ...overrides,
  };
}

function makeDb(queryResults: unknown[][] = [], executeMock = vi.fn()): DbAdapter {
  let callIdx = 0;
  return {
    query: vi.fn(async () => {
      const result = queryResults[callIdx] ?? [];
      callIdx++;
      return result;
    }),
    execute: executeMock,
  };
}

function makeAdapter(overrides: Partial<PayPalAdapter> = {}): PayPalAdapter {
  return {
    createOrder: vi.fn(async () => ({
      paypalOrderId: 'PP_ORDER_ABC',
      approvalUrl: 'https://www.paypal.com/checkoutnow?token=PP_ORDER_ABC',
    })),
    captureOrder: vi.fn(async () => ({
      captureId: 'PP_CAPTURE_001',
      status: 'completed' as const,
      payerEmail: 'buyer@example.com',
      payerName: 'Hans Mueller',
    })),
    refundCapture: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('createPayPalOrder', () => {
  it('vytvoří PayPal objednávku a vrátí approvalUrl', async () => {
    const db = makeDb([[makeOrderRow()]]);
    const adapter = makeAdapter();

    const result = await createPayPalOrder({
      orderId: 'order-001',
      userId: 'user-001',
      amountHellers: 200000,
      description: 'Vstupenka na festival',
      returnUrl: 'https://app.example.com/paypal/return',
      cancelUrl: 'https://app.example.com/paypal/cancel',
    }, adapter, db);

    expect(result.approvalUrl).toContain('paypal.com');
    expect(result.paypalOrder.paypalOrderId).toBe('PP_ORDER_ABC');
    expect(result.paypalOrder.status).toBe('created');
    expect(adapter.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      amountHellers: 200000,
      currency: 'CZK',
    }));
  });

  it('odmítne nulovou částku', async () => {
    const db = makeDb();
    const adapter = makeAdapter();
    await expect(createPayPalOrder({
      orderId: 'o', userId: 'u', amountHellers: 0,
      description: 'Test', returnUrl: 'https://r.cz', cancelUrl: 'https://c.cz',
    }, adapter, db)).rejects.toThrow('amountHellers must be positive');
  });

  it('odmítne prázdný popis', async () => {
    const db = makeDb();
    const adapter = makeAdapter();
    await expect(createPayPalOrder({
      orderId: 'o', userId: 'u', amountHellers: 10000,
      description: '   ', returnUrl: 'https://r.cz', cancelUrl: 'https://c.cz',
    }, adapter, db)).rejects.toThrow('description is required');
  });
});

describe('capturePayPalOrder', () => {
  it('zachytí schválenou PayPal platbu', async () => {
    const createdRow = makeOrderRow({ status: 'created' });
    const capturedRow = makeOrderRow({
      status: 'captured',
      paypal_capture_id: 'PP_CAPTURE_001',
      payer_email: 'buyer@example.com',
      payer_name: 'Hans Mueller',
      captured_at: '2026-04-14T10:30:00Z',
    });
    const db = makeDb([[createdRow], [capturedRow]]);
    const adapter = makeAdapter();

    const result = await capturePayPalOrder('PP_ORDER_ABC', adapter, db);
    expect(result.status).toBe('captured');
    expect(result.paypalCaptureId).toBe('PP_CAPTURE_001');
    expect(result.payerEmail).toBe('buyer@example.com');
  });

  it('vrátí failed stav pokud PayPal odmítne platbu', async () => {
    const createdRow = makeOrderRow({ status: 'created' });
    const failedRow = makeOrderRow({ status: 'failed', error_code: 'DECLINED' });
    const db = makeDb([[createdRow], [failedRow]]);
    const adapter = makeAdapter({
      captureOrder: vi.fn(async () => ({
        captureId: '',
        status: 'declined' as const,
        payerEmail: null,
        payerName: null,
      })),
    });

    const result = await capturePayPalOrder('PP_ORDER_ABC', adapter, db);
    expect(result.status).toBe('failed');
  });

  it('vyhodí chybu pro neexistující objednávku', async () => {
    const db = makeDb([[]]); // not found
    const adapter = makeAdapter();
    await expect(capturePayPalOrder('UNKNOWN', adapter, db)).rejects.toThrow('PAYPAL_ORDER_NOT_FOUND');
  });

  it('vyhodí chybu pro nesprávný stav', async () => {
    const db = makeDb([[makeOrderRow({ status: 'refunded' })]]);
    const adapter = makeAdapter();
    await expect(capturePayPalOrder('PP_ORDER_ABC', adapter, db)).rejects.toThrow('INVALID_STATE');
  });
});

describe('refundPayPalOrder', () => {
  it('vrátí platbu a označí jako refunded', async () => {
    const capturedRow = makeOrderRow({
      status: 'captured',
      paypal_capture_id: 'PP_CAPTURE_001',
      amount_hellers: '200000',
    });
    const refundedRow = makeOrderRow({ status: 'refunded' });
    const db = makeDb([[capturedRow], [refundedRow]]);
    const adapter = makeAdapter();

    const result = await refundPayPalOrder('PP_ORDER_ABC', adapter, db);
    expect(result.status).toBe('refunded');
    expect(adapter.refundCapture).toHaveBeenCalledWith('PP_CAPTURE_001', 200000);
  });

  it('vyhodí chybu pokud objednávka není captured', async () => {
    const db = makeDb([[]]); // empty = not captured
    const adapter = makeAdapter();
    await expect(refundPayPalOrder('PP_ORDER_ABC', adapter, db))
      .rejects.toThrow('PAYPAL_ORDER_NOT_FOUND or not captured');
  });
});

describe('getPayPalOrder', () => {
  it('vrátí stav PayPal objednávky', async () => {
    const db = makeDb([[makeOrderRow({ status: 'approved' })]]);
    const result = await getPayPalOrder('PP_ORDER_ABC', db);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('approved');
  });

  it('vrátí null pro neexistující objednávku', async () => {
    const db = makeDb([[]]); // empty
    const result = await getPayPalOrder('UNKNOWN', db);
    expect(result).toBeNull();
  });
});
