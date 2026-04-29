// =============================================================================
// Wero Payment Service Tests
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  initiateWeroPayment,
  confirmPayment,
  updatePaymentStatus,
  getPaymentForOrder,
  cancelPayment,
  getWeroStats,
} from '../services/wero-payment.service';
import { WeroError } from '../lib/wero-errors';

describe('Wero Payment Service', () => {
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

  describe('initiateWeroPayment', () => {
    it('should create payment record and return redirect URL', async () => {
      const paymentRow = {
        id: 'payment-123',
        order_id: 'order-123',
        promoter_id: 'promoter-123',
        status: 'initiated',
        external_id: 'wero-external-123',
        amount_halire: 100000,
        iban_hash: null,
        initiated_at: '2026-04-18T00:00:00Z',
        authorized_at: null,
        confirmed_at: null,
        error_code: null,
        error_message: null,
        created_at: '2026-04-18T00:00:00Z',
        updated_at: '2026-04-18T00:00:00Z',
      };

      mockWeroClient.initiatePayment.mockResolvedValueOnce({
        redirectUrl: 'https://wero.io/authorize?id=wero-external-123',
        paymentId: 'wero-external-123',
        status: 'initiated',
      });

      mockDb.transaction.mockImplementationOnce(async (cb: any) => {
        return cb(mockDb);
      });

      mockDb.query.mockResolvedValueOnce([paymentRow]);

      const result = await initiateWeroPayment(
        'order-123',
        'promoter-123',
        100000,
        'https://return.url',
        deps,
      );

      expect(result.redirectUrl).toBe('https://wero.io/authorize?id=wero-external-123');
      expect(result.paymentId).toBe('payment-123');
      expect(mockWeroClient.initiatePayment).toHaveBeenCalledWith(
        'order-123',
        100000,
        'https://return.url',
      );
    });

    it('should throw on invalid amount', async () => {
      expect(() =>
        initiateWeroPayment('order-123', 'promoter-123', -100, 'https://return.url', deps),
      ).rejects.toThrow('WERO_INVALID_AMOUNT');

      expect(() =>
        initiateWeroPayment('order-123', 'promoter-123', 100.5, 'https://return.url', deps),
      ).rejects.toThrow('WERO_INVALID_AMOUNT');
    });

    it('should throw on DB insert failure', async () => {
      mockWeroClient.initiatePayment.mockResolvedValueOnce({
        redirectUrl: 'https://wero.io/authorize?id=wero-external-123',
        paymentId: 'wero-external-123',
        status: 'initiated',
      });

      mockDb.transaction.mockImplementationOnce(async (cb: any) => {
        return cb(mockDb);
      });

      mockDb.query.mockResolvedValueOnce([null]); // Insert returned null

      await expect(
        initiateWeroPayment('order-123', 'promoter-123', 100000, 'https://return.url', deps),
      ).rejects.toThrow(Error);
    });
  });

  describe('confirmPayment', () => {
    it('should update payment to confirmed status', async () => {
      const confirmedRow = {
        id: 'payment-123',
        order_id: 'order-123',
        promoter_id: 'promoter-123',
        status: 'confirmed',
        external_id: 'wero-123',
        amount_halire: 100000,
        iban_hash: null,
        initiated_at: '2026-04-18T00:00:00Z',
        authorized_at: null,
        confirmed_at: '2026-04-18T01:00:00Z',
        error_code: null,
        error_message: null,
        created_at: '2026-04-18T00:00:00Z',
        updated_at: '2026-04-18T01:00:00Z',
      };

      mockDb.query.mockResolvedValueOnce([confirmedRow]);

      const result = await confirmPayment('payment-123', 'order-123', mockDb);

      expect(result.status).toBe('confirmed');
      expect(result.confirmedAt).toBe('2026-04-18T01:00:00Z');
    });

    it('should throw on non-existent payment', async () => {
      mockDb.query.mockResolvedValueOnce([null]);

      expect(() => confirmPayment('nonexistent', 'order-123', mockDb)).rejects.toThrow(
        'WERO_PAYMENT_NOT_FOUND',
      );
    });
  });

  describe('updatePaymentStatus', () => {
    it('should update status to authorized with timestamp', async () => {
      const updatedRow = {
        id: 'payment-123',
        order_id: 'order-123',
        promoter_id: 'promoter-123',
        status: 'authorized',
        external_id: 'wero-123',
        amount_halire: 100000,
        iban_hash: null,
        initiated_at: '2026-04-18T00:00:00Z',
        authorized_at: '2026-04-18T00:30:00Z',
        confirmed_at: null,
        error_code: null,
        error_message: null,
        created_at: '2026-04-18T00:00:00Z',
        updated_at: '2026-04-18T00:30:00Z',
      };

      mockDb.query.mockResolvedValueOnce([updatedRow]);

      const result = await updatePaymentStatus('payment-123', 'authorized', undefined, undefined, mockDb);

      expect(result.status).toBe('authorized');
      expect(result.authorizedAt).toBe('2026-04-18T00:30:00Z');
    });

    it('should include error code/message on failure', async () => {
      const failedRow = {
        id: 'payment-123',
        order_id: 'order-123',
        promoter_id: 'promoter-123',
        status: 'failed',
        external_id: 'wero-123',
        amount_halire: 100000,
        iban_hash: null,
        initiated_at: '2026-04-18T00:00:00Z',
        authorized_at: null,
        confirmed_at: null,
        error_code: 'INSUFFICIENT_FUNDS',
        error_message: 'Account balance insufficient',
        created_at: '2026-04-18T00:00:00Z',
        updated_at: '2026-04-18T01:00:00Z',
      };

      mockDb.query.mockResolvedValueOnce([failedRow]);

      const result = await updatePaymentStatus(
        'payment-123',
        'failed',
        'INSUFFICIENT_FUNDS',
        'Account balance insufficient',
        mockDb,
      );

      expect(result.status).toBe('failed');
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('error_code'),
        expect.arrayContaining(['INSUFFICIENT_FUNDS', 'Account balance insufficient']),
      );
    });
  });

  describe('getPaymentForOrder', () => {
    it('should fetch latest payment for order', async () => {
      const paymentRow = {
        id: 'payment-123',
        order_id: 'order-123',
        promoter_id: 'promoter-123',
        status: 'confirmed',
        external_id: 'wero-123',
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

      mockDb.query.mockResolvedValueOnce([paymentRow]);

      const result = await getPaymentForOrder('order-123', mockDb);

      expect(result.orderId).toBe('order-123');
      expect(result.status).toBe('confirmed');
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        ['order-123'],
      );
    });

    it('should throw on non-existent order', async () => {
      mockDb.query.mockResolvedValueOnce([null]);

      expect(() => getPaymentForOrder('nonexistent', mockDb)).rejects.toThrow(
        'WERO_PAYMENT_NOT_FOUND',
      );
    });
  });

  describe('cancelPayment', () => {
    it('should mark payment as failed', async () => {
      const cancelledRow = {
        id: 'payment-123',
        order_id: 'order-123',
        promoter_id: 'promoter-123',
        status: 'failed',
        external_id: 'wero-123',
        amount_halire: 100000,
        iban_hash: null,
        initiated_at: '2026-04-18T00:00:00Z',
        authorized_at: null,
        confirmed_at: null,
        error_code: 'USER_CANCELLED',
        error_message: 'Payment cancelled by user',
        created_at: '2026-04-18T00:00:00Z',
        updated_at: '2026-04-18T02:00:00Z',
      };

      mockDb.query.mockResolvedValueOnce([cancelledRow]);

      const result = await cancelPayment('payment-123', mockDb);

      expect(result.status).toBe('failed');
    });

    it('should throw on non-existent payment', async () => {
      mockDb.query.mockResolvedValueOnce([null]);

      expect(() => cancelPayment('nonexistent', mockDb)).rejects.toThrow(
        'WERO_PAYMENT_NOT_FOUND',
      );
    });
  });

  describe('getWeroStats', () => {
    it('should aggregate successful payments by promoter', async () => {
      mockDb.query.mockResolvedValueOnce([
        {
          successful_count: '5',
          total_volume: '500000',
          avg_amount: '100000',
        },
      ]);

      const result = await getWeroStats('promoter-123', mockDb);

      expect(result.promoterId).toBe('promoter-123');
      expect(result.successfulPaymentsCount).toBe(5);
      expect(result.totalVolumeHalire).toBe(500000);
      expect(result.averageAmountHalire).toBe(100000);
    });

    it('should return zeros for promoter with no payments', async () => {
      mockDb.query.mockResolvedValueOnce([
        {
          successful_count: '0',
          total_volume: '0',
          avg_amount: '0',
        },
      ]);

      const result = await getWeroStats('promoter-no-payments', mockDb);

      expect(result.successfulPaymentsCount).toBe(0);
      expect(result.totalVolumeHalire).toBe(0);
      expect(result.averageAmountHalire).toBe(0);
    });

    it('should handle null results gracefully', async () => {
      mockDb.query.mockResolvedValueOnce([null]);

      const result = await getWeroStats('promoter-123', mockDb);

      expect(result.successfulPaymentsCount).toBe(0);
      expect(result.totalVolumeHalire).toBe(0);
      expect(result.averageAmountHalire).toBe(0);
    });
  });

  describe('idempotency', () => {
    it('should handle duplicate webhook events gracefully', async () => {
      const paymentRow = {
        id: 'payment-123',
        order_id: 'order-123',
        promoter_id: 'promoter-123',
        status: 'confirmed',
        external_id: 'wero-123',
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

      mockDb.query.mockResolvedValue([paymentRow]);

      // Calling twice should not error
      const result1 = await updatePaymentStatus('payment-123', 'confirmed', undefined, undefined, mockDb);
      const result2 = await updatePaymentStatus('payment-123', 'confirmed', undefined, undefined, mockDb);

      expect(result1.status).toBe('confirmed');
      expect(result2.status).toBe('confirmed');
    });
  });
});
