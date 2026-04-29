/**
 * Smoke Test 01: Health checks
 * Verifies core API endpoints are reachable and return expected shapes.
 */
import { test, expect } from '@playwright/test';
import { api } from '../utils/api-client.js';

test.describe('Health & Readiness', () => {
  test('GET /api/health returns 200 with status=ok', async () => {
    const res = await api.get<{ status: string }>('/api/health');
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('ok');
  });

  test('GET /api/health/db returns 200 — database is reachable', async () => {
    const res = await api.get<{ status: string; latencyMs: number }>('/api/health/db');
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('ok');
    expect(typeof res.data.latencyMs).toBe('number');
  });

  test('GET /api/health/redis returns 200 — Redis is reachable', async () => {
    const res = await api.get<{ status: string }>('/api/health/redis');
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('ok');
  });

  test('Unknown route returns 404', async () => {
    const res = await api.get('/api/nonexistent-route-xyz');
    expect(res.status).toBe(404);
  });
});
