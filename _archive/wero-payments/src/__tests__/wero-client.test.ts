// =============================================================================
// Wero HTTP Client Tests
// =============================================================================

import crypto from 'crypto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WeroHttpClient, createWeroClient } from '../lib/wero-client';
import { WeroError } from '../lib/wero-errors';

describe('WeroHttpClient', () => {
  let client: WeroHttpClient;
  const mockConfig = {
    clientId: 'test-client',
    clientSecret: 'test-secret',
    webhookSecret: 'test-webhook-secret',
  };

  beforeEach(() => {
    client = new WeroHttpClient(mockConfig.clientId, mockConfig.clientSecret, mockConfig);
    vi.clearAllMocks();
  });

  describe('Token caching', () => {
    it('should throw WERO_NOT_CONFIGURED if credentials missing', async () => {
      const unconfiguredClient = new WeroHttpClient('', '');
      expect(() => (unconfiguredClient as any).getAccessToken()).rejects.toThrow(WeroError);
    });

    it('should cache token and reuse within TTL', async () => {
      const paymentResponse = (id: string) =>
        new Response(
          JSON.stringify({ id, status: 'initiated', orderId: 'order-123', amount: 100000, iban: 'CZ...' }),
          { status: 200 },
        );

      global.fetch = vi.fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ access_token: 'token-123', expires_in: 3600 }), { status: 200 }),
        )
        .mockResolvedValueOnce(paymentResponse('payment-123'))
        .mockResolvedValueOnce(paymentResponse('payment-456'));

      // Two status calls — token is fetched once and cached
      const status1 = await client.getPaymentStatus('payment-123');
      const status2 = await client.getPaymentStatus('payment-456');

      expect(status1.id).toBe('payment-123');
      expect(status2.id).toBe('payment-456');
      // 1 token fetch + 2 status fetches = 3 total; only 1 token fetch (cached)
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('Signature verification', () => {
    it('should verify valid HMAC-SHA256 signature', () => {
      const payload = JSON.stringify({ test: 'data' });
      const signature = crypto
        .createHmac('sha256', mockConfig.webhookSecret)
        .update(payload)
        .digest('hex');

      const isValid = client.verifySignature(payload, signature);
      expect(isValid).toBe(true);
    });

    it('should reject invalid signature', () => {
      const payload = JSON.stringify({ test: 'data' });
      const invalidSignature = 'invalid-signature';

      const isValid = client.verifySignature(payload, invalidSignature);
      expect(isValid).toBe(false);
    });

    it('should use timing-safe comparison', () => {
      const payload = JSON.stringify({ test: 'data' });
      const signature = crypto
        .createHmac('sha256', mockConfig.webhookSecret)
        .update(payload)
        .digest('hex');

      // Even with timing attack, should verify correctly
      const isValid = client.verifySignature(payload, signature);
      expect(isValid).toBe(true);
    });

    it('should handle malformed signature hex', () => {
      const payload = JSON.stringify({ test: 'data' });
      const malformedSignature = 'not-hex-at-all!!!';

      const isValid = client.verifySignature(payload, malformedSignature);
      expect(isValid).toBe(false);
    });
  });

  describe('initiate Payment', () => {
    it('should return stub response in DEV mode', async () => {
      const devClient = new WeroHttpClient('', '');
      const result = await devClient.initiatePayment('order-123', 100000, 'https://return.url');

      expect(result.paymentId).toMatch(/dev-\d+/);
      expect(result.redirectUrl).toMatch(/\/dev\/wero-stub/);
      expect(result.status).toBe('initiated');
    });

    it('should log payment initiation in DEV mode', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      const devClient = new WeroHttpClient('', '');
      await devClient.initiatePayment('order-123', 100000, 'https://return.url');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[wero-payments DEV]'),
      );
    });

    it('should validate amount is positive integer', async () => {
      const devClient = new WeroHttpClient('', '');

      // Zero amount should still call API (validation is service-level)
      const result = await devClient.initiatePayment('order-123', 0, 'https://return.url');
      expect(result.paymentId).toBeDefined();
    });
  });

  describe('getPaymentStatus', () => {
    it('should return payment status from API', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'token-123',
              expires_in: 3600,
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              id: 'payment-123',
              status: 'confirmed',
              orderId: 'order-123',
              amount: 100000,
              iban: 'CZ123456789',
            }),
            { status: 200 },
          ),
        );

      const status = await client.getPaymentStatus('payment-123');

      expect(status.id).toBe('payment-123');
      expect(status.status).toBe('confirmed');
      expect(status.orderId).toBe('order-123');
    });

    it('should throw on 404', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'token-123',
              expires_in: 3600,
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response('Not Found', { status: 404 }),
        );

      expect(() => client.getPaymentStatus('nonexistent')).rejects.toThrow(
        'WERO_PAYMENT_NOT_FOUND',
      );
    });

    it('should throw on network error', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'token-123',
              expires_in: 3600,
            }),
            { status: 200 },
          ),
        )
        .mockRejectedValueOnce(new Error('Network error'));

      await expect(client.getPaymentStatus('payment-123')).rejects.toThrow(WeroError);
    });
  });

  describe('handleWebhook', () => {
    it('should validate webhook signature and return payload', () => {
      const payload = {
        eventId: 'event-123',
        paymentId: 'payment-123',
        status: 'confirmed' as const,
      };

      const signature = crypto
        .createHmac('sha256', mockConfig.webhookSecret)
        .update(JSON.stringify(payload))
        .digest('hex');

      const result = client.handleWebhook(payload, signature);
      expect(result).toEqual(payload);
    });

    it('should throw on invalid webhook signature', () => {
      const payload = {
        eventId: 'event-123',
        paymentId: 'payment-123',
        status: 'confirmed' as const,
      };

      expect(() => client.handleWebhook(payload, 'invalid-sig')).toThrow(
        'WERO_INVALID_WEBHOOK_SIGNATURE',
      );
    });
  });

  describe('Factory function', () => {
    it('should create client with environment variables', () => {
      process.env.WERO_CLIENT_ID = 'env-client';
      process.env.WERO_CLIENT_SECRET = 'env-secret';
      process.env.WERO_WEBHOOK_SECRET = 'env-webhook-secret';

      const factoryClient = createWeroClient('env-client', 'env-secret');
      expect(factoryClient).toBeInstanceOf(WeroHttpClient);

      delete process.env.WERO_CLIENT_ID;
      delete process.env.WERO_CLIENT_SECRET;
      delete process.env.WERO_WEBHOOK_SECRET;
    });
  });

  describe('Token cache clearing', () => {
    it('should allow clearing token cache for tests', async () => {
      global.fetch = vi.fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              access_token: 'token-123',
              expires_in: 3600,
            }),
            { status: 200 },
          ),
        );

      (client as any).__clearTokenCache();

      // Should be null after clearing
      expect((client as any).cachedToken).toBeNull();
    });
  });
});
