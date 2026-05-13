import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET as consentGet, POST as consentPost } from '../app/api/consent/route.js';
import { GET as historyGet } from '../app/api/consent/history/route.js';
import { POST as revokeAllPost } from '../app/api/consent/revoke-all/route.js';
import { GET as exportGet } from '../app/api/consent/export/route.js';
import type { NextRequest } from 'next/server';

const DEFAULT_CONSENT_ROW = {
  id: 'consent-1',
  user_id: 'user-123',
  type: 'marketing',
  status: 'granted',
  granted_at: new Date().toISOString(),
  withdrawn_at: null,
  lawful_basis: 'legitimate_interest',
  ip_address: null,
  user_agent: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

// Mock getServiceDeps
vi.mock('../lib/service-container.js', () => ({
  getServiceDeps: vi.fn(() => ({
    db: {
      query: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({
        query: vi.fn().mockResolvedValue([DEFAULT_CONSENT_ROW]),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(async (fn2: (tx: unknown) => unknown) => fn2({
          query: vi.fn().mockResolvedValue([DEFAULT_CONSENT_ROW]),
          execute: vi.fn().mockResolvedValue(undefined),
          transaction: vi.fn(),
        })),
      })),
    },
  })),
}));

function makeRequest(options: {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  url?: string;
}): Partial<NextRequest> {
  const { method = 'GET', headers = {}, body, url = 'http://localhost:3000' } = options;

  const req = {
    method,
    url,
    headers: new Map(Object.entries(headers)) as any,
    ip: '127.0.0.1',
    json: async () => body,
  } as unknown as NextRequest;

  return req;
}

describe('GET /api/consent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without user ID', async () => {
    const req = makeRequest({ method: 'GET', headers: {} });
    const res = await consentGet(req as NextRequest);
    expect(res.status).toBe(401);
  });

  it('returns consent status for user', async () => {
    const req = makeRequest({
      method: 'GET',
      headers: { 'x-user-id': 'user-123' },
    });
    const res = await consentGet(req as NextRequest);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/consent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without user ID', async () => {
    const req = makeRequest({
      method: 'POST',
      headers: {},
      body: { type: 'marketing', status: 'granted' },
    });
    const res = await consentPost(req as NextRequest);
    expect(res.status).toBe(401);
  });

  it('returns 400 for missing type or status', async () => {
    const req = makeRequest({
      method: 'POST',
      headers: { 'x-user-id': 'user-123' },
      body: { type: 'marketing' },
    });
    const res = await consentPost(req as NextRequest);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid type', async () => {
    const req = makeRequest({
      method: 'POST',
      headers: { 'x-user-id': 'user-123' },
      body: { type: 'invalid', status: 'granted' },
    });
    const res = await consentPost(req as NextRequest);
    expect(res.status).toBe(400);
  });

  it('returns 200 for valid consent update', async () => {
    const req = makeRequest({
      method: 'POST',
      headers: { 'x-user-id': 'user-123' },
      body: { type: 'marketing', status: 'granted', reason: 'accepted' },
    });
    const res = await consentPost(req as NextRequest);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/consent/history', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without user ID', async () => {
    const req = makeRequest({ method: 'GET', headers: {} });
    const res = await historyGet(req as NextRequest);
    expect(res.status).toBe(401);
  });

  it('returns paginated history', async () => {
    const req = makeRequest({
      method: 'GET',
      headers: { 'x-user-id': 'user-123' },
      url: 'http://localhost:3000/api/consent/history?limit=50&offset=0',
    });
    const res = await historyGet(req as NextRequest);
    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid type filter', async () => {
    const req = makeRequest({
      method: 'GET',
      headers: { 'x-user-id': 'user-123' },
      url: 'http://localhost:3000/api/consent/history?type=invalid',
    });
    const res = await historyGet(req as NextRequest);
    expect(res.status).toBe(400);
  });

  it('validates limit and offset', async () => {
    const req = makeRequest({
      method: 'GET',
      headers: { 'x-user-id': 'user-123' },
      url: 'http://localhost:3000/api/consent/history?limit=500&offset=-1',
    });
    const res = await historyGet(req as NextRequest);
    expect(res.status).toBe(200); // Should clamp to defaults
  });
});

describe('POST /api/consent/revoke-all', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without user ID', async () => {
    const req = makeRequest({
      method: 'POST',
      headers: {},
      body: {},
    });
    const res = await revokeAllPost(req as NextRequest);
    expect(res.status).toBe(401);
  });

  it('revokes all consents with reason', async () => {
    const req = makeRequest({
      method: 'POST',
      headers: { 'x-user-id': 'user-123' },
      body: { reason: 'User requested deletion' },
    });
    const res = await revokeAllPost(req as NextRequest);
    expect(res.status).toBe(200);
  });

  it('works with empty body', async () => {
    const req = makeRequest({
      method: 'POST',
      headers: { 'x-user-id': 'user-123' },
      body: {},
    });
    const res = await revokeAllPost(req as NextRequest);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/consent/export', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without user ID', async () => {
    const req = makeRequest({ method: 'GET', headers: {} });
    const res = await exportGet(req as NextRequest);
    expect(res.status).toBe(401);
  });

  it('returns GDPR export data', async () => {
    const req = makeRequest({
      method: 'GET',
      headers: { 'x-user-id': 'user-123' },
    });
    const res = await exportGet(req as NextRequest);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
  });

  it('includes filename with user ID and date', async () => {
    const req = makeRequest({
      method: 'GET',
      headers: { 'x-user-id': 'user-456' },
    });
    const res = await exportGet(req as NextRequest);
    const disposition = res.headers.get('Content-Disposition');
    expect(disposition).toContain('user-456');
    expect(disposition).toMatch(/\d{4}-\d{2}-\d{2}/); // Date format
  });
});
