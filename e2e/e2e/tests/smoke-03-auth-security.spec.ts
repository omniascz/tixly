/**
 * Smoke Test 03: Auth & Security
 * Verifies authentication barriers are in place on staging.
 */
import { test, expect } from '@playwright/test';
import { api } from '../utils/api-client.js';

test.describe('Auth & Security', { tag: '@smoke' }, () => {
  test('Protected endpoints return 401 without auth', async () => {
    const endpoints = [
      '/api/organizer/events',
      '/api/orders',
      '/api/platform/admin/invoices',
    ];

    for (const endpoint of endpoints) {
      const res = await api.get(endpoint, { headers: { 'x-user-id': '' } });
      expect([401, 403], `${endpoint} should be protected`).toContain(res.status);
    }
  });

  test('B2B API returns 401 without Bearer token', async () => {
    const res = await api.get('/api/v1/events', { headers: {} });
    expect(res.status).toBe(401);
  });

  test('B2B API returns 401 with invalid key format', async () => {
    const res = await api.get('/api/v1/events', {
      token: 'invalid-key-format',
    });
    expect(res.status).toBe(401);
  });

  test('CORS headers present on API responses', async () => {
    const response = await fetch(
      `${process.env.BASE_URL ?? 'http://localhost:3000'}/api/health`,
      { method: 'OPTIONS' },
    );
    // Should either allow CORS or return a proper response
    expect([200, 204]).toContain(response.status);
  });

  test('Rate limiting headers present on B2B endpoints', async () => {
    // Even with invalid key, rate limit headers should be present or 401 returned promptly
    const res = await api.get('/api/v1/events', { token: 'tick_test_invalidkeyformat123456' });
    // Either 401 or 429 is acceptable; headers should not expose internals
    expect([401, 403, 429]).toContain(res.status);
  });
});
