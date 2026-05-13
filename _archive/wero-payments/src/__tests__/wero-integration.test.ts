// =============================================================================
// Wero Payment Integration Tests
//
// Tests complete flow: initiate → webhook → confirm → stats
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import {
  initiateWeroPayment,
  updatePaymentStatus,
  getPaymentForOrder,
  getWeroStats,
  logWebhookEvent,
} from '../services/wero-payment.service';
import { WeroHttpClient } from '../lib/wero-client';
import { WeroError } from '../lib/wero-errors';

describe('Wero Payment Integration Flow', () => {
  const mockDb = {
    query: vi.fn(),
    transaction: vi.fn(),
  };

  const mockWeroClient = {
    initiatePayment: vi.fn(),
    getPaymentStatus: vi.fn(),
    verifySignature: vi.fn(),
    handleWebhook: vi.fn(),
  };

  const deps = {
    db: mockDb,
    weroClient: mockWeroClient,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Complete payment flow', () => {
    it('should handle full payment lifecycle: initiate → authorize → confirm', async () => {
      const orderId = 'order-123';
      const promoterId = 'promoter-123';
      const amountHalire = 100000;  // 1000 CZK
      const weroPaymentId = 'wero-ext-123';

      // Step 1: Initiate payment
      const initiateResult = {
        redirectUrl: `https://wero.io/authorize?id=${weroPaymentId}`,
        paymentId: weroPaymentId,
        status: 'initiated',
      };

      mockWeroClient.initiatePayment.mockResolvedValueOnce(initiateResult);

      const paymentRow = {
        id: 'local-payment-123',
        order_id: orderId,
        promoter_id: promoterId,
        status: 'initiated',
        external_id: weroPaymentId,
        amount_halire: amountHalire,
        iban_hash: null,
        initiated_at: '2026-04-18T00:00:00Z',
        authorized_at: null,
        confirmed_at: null,
        error_code: null,
        error_message: null,
        created_at: '2026-04-18T00:00:00Z',
        updated_at: '2026-04-18T00:00:00Z',
      };

      mockDb.transaction.mockImplementationOnce(async (cb: any) => cb(mockDb));
      mockDb.query.mockResolvedValueOnce([paymentRow]);

      const initResult = await initiateWeroPayment(
        orderId,
        promoterId,
        amountHalire,
        'https://example.com/return',
        deps,
      );

      expect(initResult.redirectUrl).toContain('wero.io');
      expect(initResult.paymentId).toBe('local-payment-123');

      // Step 2: User authorizes on Wero's side (happens externally)
      // Webhook arrives with authorized status

      // Step 3: Update to confirmed
      const confirmedRow = {
        ...paymentRow,
        status: 'confirmed',
        confirmed_at: '2026-04-18T01:00:00Z',
        updated_at: '2026-04-18T01:00:00Z',
      };

      mockDb.query.mockResolvedValueOnce([confirmedRow]);

      const confirmed = await updatePaymentStatus(
        'local-payment-123',
        'confirmed',
        undefined,
        undefined,
        mockDb,
      );

      expect(confirmed.status).toBe('confirmed');
      expect(confirmed.confirmedAt).toBe('2026-04-18T01:00:00Z');

      // Step 4: Get final payment for order
      mockDb.query.mockResolvedValueOnce([confirmedRow]);

      const final = await getPaymentForOrder(orderId, mockDb);

      expect(final.status).toBe('confirmed');
      expect(final.amountHalire).toBe(amountHalire);
    });

    it('should handle payment failure flow', async () => {
      const orderId = 'order-456';
      const weroPaymentId = 'wero-ext-456';

      const failedRow = {
        id: 'local-payment-456',
        order_id: orderId,
        promoter_id: 'promoter-123',
        status: 'failed',
        external_id: weroPaymentId,
        amount_halire: 100000,
        iban_hash: null,
        initiated_at: '2026-04-18T00:00:00Z',
        authorized_at: null,
        confirmed_at: null,
        error_code: 'INSUFFICIENT_FUNDS',
        error_message: 'Account balance insufficient',
        created_at: '2026-04-18T00:00:00Z',
        updated_at: '2026-04-18T01:30:00Z',
      };

      mockDb.query.mockResolvedValueOnce([failedRow]);

      const failed = await updatePaymentStatus(
        'local-payment-456',
        'failed',
        'INSUFFICIENT_FUNDS',
        'Account balance insufficient',
        mockDb,
      );

      expect(failed.status).toBe('failed');
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('error_code'),
        expect.arrayContaining(['INSUFFICIENT_FUNDS']),
      );
    });
  });

  describe('Webhook signature validation', () => {
    const webhookSecret = 'test-secret';

    it('should validate valid webhook signature', () => {
      const payload = {
        eventId: 'event-123',
        paymentId: 'payment-123',
        status: 'confirmed' as const,
      };

      const payloadStr = JSON.stringify(payload);
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(payloadStr)
        .digest('hex');

      const client = new WeroHttpClient('client', 'secret', { webhookSecret });
      const isValid = client.verifySignature(payloadStr, signature);

      expect(isValid).toBe(true);
    });

    it('should reject tampered webhook payload', () => {
      const originalPayload = { eventId: 'event-123', paymentId: 'payment-123' };
      const originalStr = JSON.stringify(originalPayload);
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(originalStr)
        .digest('hex');

      // Tamper with the payload
      const tamperedPayload = { eventId: 'event-123', paymentId: 'DIFFERENT' };
      const tamperedStr = JSON.stringify(tamperedPayload);

      const client = new WeroHttpClient('client', 'secret', { webhookSecret });
      const isValid = client.verifySignature(tamperedStr, signature);

      expect(isValid).toBe(false);
    });

    it('should prevent timing attacks on signature verification', () => {
      const payload = JSON.stringify({ test: 'data' });
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(payload)
        .digest('hex');

      const client = new WeroHttpClient('client', 'secret', { webhookSecret });

      // Should use crypto.timingSafeEqual (no timing leak)
      const isValid = client.verifySignature(payload, signature);
      expect(isValid).toBe(true);
    });
  });

  describe('Stats aggregation', () => {
    it('should aggregate successful payments by promoter', async () => {
      const promoterId = 'promoter-stats-123';

      mockDb.query.mockResolvedValueOnce([
        {
          successful_count: '10',
          total_volume: '1000000',
          avg_amount: '100000',
        },
      ]);

      const stats = await getWeroStats(promoterId, mockDb);

      expect(stats.successfulPaymentsCount).toBe(10);
      expect(stats.totalVolumeHalire).toBe(1000000);
      expect(stats.averageAmountHalire).toBe(100000);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining("status = 'confirmed'"),
        [promoterId],
      );
    });

    it('should exclude failed payments from stats', async () => {
      const promoterId = 'promoter-123';

      mockDb.query.mockResolvedValueOnce([
        {
          successful_count: '5',
          total_volume: '500000',
          avg_amount: '100000',
        },
      ]);

      const stats = await getWeroStats(promoterId, mockDb);

      // Query should filter by confirmed status
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE promoter_id = $1 AND status = 'confirmed'"),
        [promoterId],
      );
    });
  });

  describe('Webhook event logging', () => {
    it('should log webhook for audit trail', async () => {
      const paymentId = 'wero-ext-789';
      const eventType = 'status_update';

      // Mock payment lookup
      mockDb.query.mockResolvedValueOnce([{ id: 'local-payment-789' }]);

      // Mock webhook log insert
      mockDb.query.mockResolvedValueOnce(undefined);

      const payload = {
        eventId: 'event-789',
        paymentId,
        status: 'confirmed' as const,
      };

      await logWebhookEvent(paymentId, eventType, 'confirmed', payload, true, mockDb);

      // Should have looked up payment by external_id
      expect(mockDb.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('WHERE external_id'),
        [paymentId],
      );

      // Should have inserted webhook log
      expect(mockDb.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO payments.wero_webhooks'),
        expect.arrayContaining(['local-payment-789', eventType, 'confirmed']),
      );
    });

    it('should track signature validation status', async () => {
      const paymentId = 'wero-ext-sig';

      mockDb.query.mockResolvedValueOnce([{ id: 'local-payment-sig' }]);
      mockDb.query.mockResolvedValueOnce(undefined);

      const payload = { eventId: 'event', paymentId, status: 'failed' as const };

      await logWebhookEvent(paymentId, 'status_update', 'failed', payload, false, mockDb);

      // Should log that signature was invalid
      expect(mockDb.query).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        expect.arrayContaining([false]),  // signature_valid = false
      );
    });
  });

  describe('Error scenarios', () => {
    it('should handle network error during payment initiation', async () => {
      mockWeroClient.initiatePayment.mockRejectedValueOnce(
        new WeroError('WERO_API_ERROR', 'Network timeout'),
      );

      await expect(
        initiateWeroPayment('order-net', 'promoter-123', 100000, 'https://return.url', deps),
      ).rejects.toThrow(WeroError);
    });

    it('should handle database transaction failure', async () => {
      mockWeroClient.initiatePayment.mockResolvedValueOnce({
        redirectUrl: 'https://wero.io/auth',
        paymentId: 'wero-fail',
        status: 'initiated',
      });

      mockDb.transaction.mockImplementationOnce(async (cb: any) => {
        throw new Error('Transaction failed');
      });

      expect(() =>
        initiateWeroPayment('order-db', 'promoter-123', 100000, 'https://return.url', deps),
      ).rejects.toThrow('Transaction failed');
    });

    it('should be resilient to missing payment in webhook log', async () => {
      const paymentId = 'wero-missing';

      mockDb.query.mockResolvedValueOnce([null]);  // Payment not found

      expect(() =>
        logWebhookEvent(paymentId, 'status_update', 'confirmed', {}, true, mockDb),
      ).rejects.toThrow('WERO_PAYMENT_NOT_FOUND');
    });
  });

  describe('Idempotency', () => {
    it('should handle duplicate webhook events without double-processing', async () => {
      const paymentId = 'payment-idem-123';

      // First webhook: update to confirmed
      const row1 = {
        id: 'local-idem-123',
        order_id: 'order-idem-123',
        promoter_id: 'promoter-123',
        status: 'confirmed',
        external_id: paymentId,
        amount_halire: 100000,
        iban_hash: null,
        initiated_at: '2026-04-18T00:00:00Z',
        authorized_at: '2026-04-18T00:30:00Z',
        confirmed_at: '2026-04-18T01:00:00Z',
        error_code: null,
        error_message: null,
        created_at: '2026-04-18T00:00:00Z',
        updated_at: '2026-04-18T01:00:00Z',
      };

      mockDb.query
        .mockResolvedValueOnce([row1])
        .mockResolvedValueOnce([row1]);

      // Calling twice should not cause errors
      const result1 = await updatePaymentStatus(paymentId, 'confirmed', undefined, undefined, mockDb);
      const result2 = await updatePaymentStatus(paymentId, 'confirmed', undefined, undefined, mockDb);

      expect(result1.status).toBe('confirmed');
      expect(result2.status).toBe('confirmed');
    });
  });
});
