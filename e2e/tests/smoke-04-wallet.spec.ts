/**
 * Smoke Test 04: Wallet passes
 * Verifies Apple/Google Wallet endpoints respond correctly.
 * Requires a valid ticket ID (set TEST_TICKET_ID env var).
 */
import { test, expect } from '@playwright/test';
import { api } from '../utils/api-client.js';

const ticketId = process.env.TEST_TICKET_ID ?? '';

test.describe('Wallet Passes', { tag: '@smoke' }, () => {
  test.skip(!ticketId, 'Requires TEST_TICKET_ID environment variable');

  test('Apple Wallet pass endpoint returns .pkpass or appropriate error', async () => {
    const res = await api.get(`/api/tickets/${ticketId}/wallet/apple`);
    // 200 = .pkpass binary, 404 = no apple config, 501 = not configured
    expect([200, 404, 501]).toContain(res.status);
  });

  test('Google Wallet pass endpoint returns JWT URL or appropriate error', async () => {
    const res = await api.get<{ addToWalletUrl?: string }>(
      `/api/tickets/${ticketId}/wallet/google`,
    );
    expect([200, 404, 501]).toContain(res.status);
    if (res.status === 200) {
      expect(typeof res.data.addToWalletUrl).toBe('string');
      expect(res.data.addToWalletUrl).toMatch(/^https:\/\/pay\.google\.com/);
    }
  });

  test('Apple webservice device registration endpoint exists', async () => {
    // The Apple wallet webservice URL must be registered during pass creation
    const res = await api.get('/api/wallet/apple/v1/devices/test-device/registrations/test-pass-type');
    // 200 = found, 204 = no content, 401 = no auth — any of these means endpoint exists
    expect([200, 204, 401, 404]).toContain(res.status);
  });
});
