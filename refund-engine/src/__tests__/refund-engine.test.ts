import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DbAdapter, Order, RefundPolicy, RefundRequest } from '../lib/types.js';
import { evaluateRefundRules } from '../lib/refund-rules.js';
import {
  createGopayReversalAdapter,
  createStripeReversalAdapter,
  getReversalAdapter,
} from '../lib/payment-reversals.js';
import {
  processRefund,
  checkRefundEligibility,
  processBatchRefunds,
  processEventCancellationRefunds,
} from '../services/refund-engine.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDb(overrides: Partial<DbAdapter> = {}): DbAdapter {
  return {
    query: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) => fn(createMockDb())),
    ...overrides,
  };
}

const yesterday = new Date(Date.now() - 86400000).toISOString();
const longAgo = new Date(Date.now() - 30 * 86400000).toISOString(); // 30 days ago

function makePaidOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    promoterId: 'p-1',
    eventId: 'e-1',
    status: 'paid',
    totalAmountHalire: 10000,
    paymentGateway: 'gopay',
    externalPaymentId: 'gp-123',
    createdAt: yesterday,
    ...overrides,
  };
}

function makePolicy(overrides: Partial<RefundPolicy> = {}): RefundPolicy {
  return {
    promoterId: 'p-1',
    refundWindowDays: 14,
    allowCustomerRefunds: true,
    maxRefundPercentage: 100,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. evaluateRefundRules: event_cancelled → eligible=true
// ---------------------------------------------------------------------------
describe('evaluateRefundRules', () => {
  it('1. event_cancelled order → eligible=true with full amount', () => {
    const order = makePaidOrder({ status: 'event_cancelled' });
    const result = evaluateRefundRules(order, null);
    expect(result.eligible).toBe(true);
    expect(result.maxRefundableHalire).toBe(order.totalAmountHalire);
  });

  it('2. non-paid order → eligible=false', () => {
    const order = makePaidOrder({ status: 'pending' });
    const result = evaluateRefundRules(order, null);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/not in paid status/);
  });

  it('3. within 14-day window (no policy) → eligible=true', () => {
    const order = makePaidOrder({ createdAt: yesterday });
    const result = evaluateRefundRules(order, null);
    expect(result.eligible).toBe(true);
    expect(result.maxRefundableHalire).toBe(10000);
  });

  it('4. expired window → eligible=false', () => {
    const order = makePaidOrder({ createdAt: longAgo });
    const result = evaluateRefundRules(order, null);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/expired/);
  });

  it('5. policy.allowCustomerRefunds=false → eligible=false', () => {
    const order = makePaidOrder();
    const policy = makePolicy({ allowCustomerRefunds: false });
    const result = evaluateRefundRules(order, policy);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/not allowed/);
  });

  it('6. maxRefundPercentage=50 → maxRefundableHalire = 50% of total', () => {
    const order = makePaidOrder({ totalAmountHalire: 10000 });
    const policy = makePolicy({ maxRefundPercentage: 50 });
    const result = evaluateRefundRules(order, policy);
    expect(result.eligible).toBe(true);
    expect(result.maxRefundableHalire).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// Payment reversal adapters
// ---------------------------------------------------------------------------
describe('payment reversal adapters', () => {
  it('7. createGopayReversalAdapter: calls callGopayApi with correct path', async () => {
    const callGopayApi = vi.fn().mockResolvedValue({ id: 'refund-gp-999' });
    const adapter = createGopayReversalAdapter(callGopayApi);
    const result = await adapter.reversePayment('gp-123', 5000);
    expect(callGopayApi).toHaveBeenCalledWith('/api/payments/gp-123/refund', 'POST', { amount: 5000 });
    expect(result.gatewayRefundId).toBe('refund-gp-999');
  });

  it('8. createStripeReversalAdapter: calls callStripeApi with correct params', async () => {
    const callStripeApi = vi.fn().mockResolvedValue({ id: 're_stripe_123' });
    const adapter = createStripeReversalAdapter(callStripeApi);
    const result = await adapter.reversePayment('pi_abc', 3000);
    expect(callStripeApi).toHaveBeenCalledWith('/v1/refunds', {
      payment_intent: 'pi_abc',
      amount: 3000,
    });
    expect(result.gatewayRefundId).toBe('re_stripe_123');
  });

  it('9. getReversalAdapter("gopay"): returns adapter', () => {
    const gopayCallFn = vi.fn();
    const adapter = getReversalAdapter('gopay', { gopayCallFn });
    expect(adapter).toBeDefined();
    expect(typeof adapter.reversePayment).toBe('function');
  });

  it('10. getReversalAdapter("stripe"): returns adapter', () => {
    const stripeCallFn = vi.fn();
    const adapter = getReversalAdapter('stripe', { stripeCallFn });
    expect(adapter).toBeDefined();
    expect(typeof adapter.reversePayment).toBe('function');
  });

  it('11. getReversalAdapter("free"): returns free adapter', async () => {
    const adapter = getReversalAdapter('free', {});
    const result = await adapter.reversePayment('any', 0);
    expect(result.gatewayRefundId).toBe('free-order-no-reversal');
  });

  it('12. getReversalAdapter("unknown"): throws error', () => {
    expect(() => getReversalAdapter('bitcoin', {})).toThrow('Unknown payment gateway: bitcoin');
  });
});

// ---------------------------------------------------------------------------
// processRefund
// ---------------------------------------------------------------------------
describe('processRefund', () => {
  it('13. successful full refund via GoPay mock', async () => {
    const mockOrder = makePaidOrder();
    const gopayCallFn = vi.fn().mockResolvedValue({ id: 'gp-refund-42' });

    const db = createMockDb({
      query: vi.fn()
        .mockResolvedValueOnce([mockOrder])  // getOrder
        .mockResolvedValueOnce([]),           // getRefundPolicy
    });

    const request: RefundRequest = {
      orderId: 'order-1',
      promoterId: 'p-1',
      reason: 'customer_request',
      requestedBy: 'customer',
    };

    const result = await processRefund(request, { db, gopayCallFn });

    expect(result.orderId).toBe('order-1');
    expect(result.amountHalire).toBe(10000);
    expect(result.status).toBe('completed');
    expect(result.gatewayRefundId).toBe('gp-refund-42');
    expect(result.paymentGateway).toBe('gopay');
    expect(typeof result.refundId).toBe('string');
    expect(typeof result.processedAt).toBe('string');
  });

  it('14. free order (totalAmountHalire=0) → status completed without gateway call', async () => {
    const mockOrder = makePaidOrder({
      totalAmountHalire: 0,
      paymentGateway: 'free',
      externalPaymentId: undefined,
    });
    const gopayCallFn = vi.fn();

    const db = createMockDb({
      query: vi.fn()
        .mockResolvedValueOnce([mockOrder])
        .mockResolvedValueOnce([]),
    });

    const request: RefundRequest = {
      orderId: 'order-1',
      promoterId: 'p-1',
      reason: 'customer_request',
      requestedBy: 'customer',
      amountHalire: 0,
    };

    // amount=0 should throw VALIDATION_ERROR
    await expect(processRefund(request, { db, gopayCallFn })).rejects.toThrow('VALIDATION_ERROR');
  });

  it('15. throws error if order not found', async () => {
    const db = createMockDb({
      query: vi.fn().mockResolvedValue([]), // empty = not found
    });

    const request: RefundRequest = {
      orderId: 'nonexistent',
      promoterId: 'p-1',
      reason: 'customer_request',
      requestedBy: 'customer',
    };

    await expect(processRefund(request, { db })).rejects.toThrow('Order not found: nonexistent');
  });

  it('16. throws error if not eligible (expired window)', async () => {
    const mockOrder = makePaidOrder({ createdAt: longAgo });

    const db = createMockDb({
      query: vi.fn()
        .mockResolvedValueOnce([mockOrder])
        .mockResolvedValueOnce([]),
    });

    const request: RefundRequest = {
      orderId: 'order-1',
      promoterId: 'p-1',
      reason: 'customer_request',
      requestedBy: 'customer',
    };

    await expect(processRefund(request, { db })).rejects.toThrow('REFUND_NOT_ELIGIBLE');
  });
});

// ---------------------------------------------------------------------------
// checkRefundEligibility
// ---------------------------------------------------------------------------
describe('checkRefundEligibility', () => {
  it('17. eligible for paid order within window', async () => {
    const mockOrder = makePaidOrder();

    const db = createMockDb({
      query: vi.fn()
        .mockResolvedValueOnce([mockOrder])
        .mockResolvedValueOnce([]),
    });

    const result = await checkRefundEligibility('order-1', 'p-1', db);
    expect(result.eligible).toBe(true);
  });

  it('18. not eligible for expired order', async () => {
    const mockOrder = makePaidOrder({ createdAt: longAgo });

    const db = createMockDb({
      query: vi.fn()
        .mockResolvedValueOnce([mockOrder])
        .mockResolvedValueOnce([]),
    });

    const result = await checkRefundEligibility('order-1', 'p-1', db);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/expired/);
  });
});

// ---------------------------------------------------------------------------
// processBatchRefunds
// ---------------------------------------------------------------------------
describe('processBatchRefunds', () => {
  it('19. processes batch successfully, failedCount=0', async () => {
    const mockOrder = makePaidOrder();
    const gopayCallFn = vi.fn().mockResolvedValue({ id: 'gp-refund-batch' });

    const db = createMockDb({
      query: vi.fn()
        .mockResolvedValueOnce([mockOrder])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ ...mockOrder, id: 'order-2' }])
        .mockResolvedValueOnce([]),
    });

    const requests: RefundRequest[] = [
      { orderId: 'order-1', promoterId: 'p-1', reason: 'customer_request', requestedBy: 'customer' },
      { orderId: 'order-2', promoterId: 'p-1', reason: 'customer_request', requestedBy: 'customer' },
    ];

    const result = await processBatchRefunds(requests, { db, gopayCallFn });
    expect(result.failedCount).toBe(0);
    expect(result.results).toHaveLength(2);
  });

  it('20. partial success → failedCount=1 when one fails', async () => {
    const mockOrder = makePaidOrder();
    const gopayCallFn = vi.fn().mockResolvedValue({ id: 'gp-refund-ok' });

    const db = createMockDb({
      query: vi.fn()
        .mockResolvedValueOnce([mockOrder])  // first order found
        .mockResolvedValueOnce([])            // first policy
        .mockResolvedValueOnce([])            // second order NOT found → will throw
        .mockResolvedValueOnce([]),
    });

    const requests: RefundRequest[] = [
      { orderId: 'order-1', promoterId: 'p-1', reason: 'customer_request', requestedBy: 'customer' },
      { orderId: 'order-missing', promoterId: 'p-1', reason: 'customer_request', requestedBy: 'customer' },
    ];

    const result = await processBatchRefunds(requests, { db, gopayCallFn });
    expect(result.failedCount).toBe(1);
    expect(result.results).toHaveLength(1);
  });

  it('22. results contain correct amountHalire', async () => {
    const mockOrder = makePaidOrder({ totalAmountHalire: 25000 });
    const gopayCallFn = vi.fn().mockResolvedValue({ id: 'gp-refund-25k' });

    const db = createMockDb({
      query: vi.fn()
        .mockResolvedValueOnce([mockOrder])
        .mockResolvedValueOnce([]),
    });

    const requests: RefundRequest[] = [
      { orderId: 'order-1', promoterId: 'p-1', reason: 'customer_request', requestedBy: 'customer' },
    ];

    const result = await processBatchRefunds(requests, { db, gopayCallFn });
    expect(result.results[0].amountHalire).toBe(25000);
  });
});

// ---------------------------------------------------------------------------
// processEventCancellationRefunds
// ---------------------------------------------------------------------------
describe('processEventCancellationRefunds', () => {
  it('21. calls execute for event cancel and processes orders', async () => {
    const mockOrder = makePaidOrder();
    const gopayCallFn = vi.fn().mockResolvedValue({ id: 'gp-cancel-refund' });

    const db = createMockDb({
      query: vi.fn().mockResolvedValueOnce([mockOrder]),
      execute: vi.fn().mockResolvedValue(undefined),
    });

    const result = await processEventCancellationRefunds('e-1', 'p-1', { db, gopayCallFn });

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE events SET status = 'cancelled'"),
      ['e-1']
    );
    expect(result.total).toBe(1);
    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
  });
});
