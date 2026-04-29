import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mockujeme service modul před importem routes
// ---------------------------------------------------------------------------
vi.mock('../services/fee.service', () => ({
  listFeeSchedules: vi.fn(),
  createFeeSchedule: vi.fn(),
  updateFeeSchedule: vi.fn(),
  deactivateFeeSchedule: vi.fn(),
  getActiveFeeSchedule: vi.fn(),
  calculateOrderFee: vi.fn(),
}));

import * as feeService from '../services/fee.service';

// Import routes po nastavení mocků
import {
  GET as adminGetSchedules,
  POST as adminPostSchedule,
  _setDeps as setAdminListDeps,
} from '../app/api/platform/admin/fee-schedules/route';
import {
  DELETE as adminDeleteSchedule,
  _setDeps as setAdminScheduleDeps,
} from '../app/api/platform/admin/fee-schedules/[scheduleId]/route';
import {
  GET as promoterGetSchedule,
  _setDeps as setPromoterDeps,
} from '../app/api/platform/promoters/[promoterId]/fee-schedule/route';
import {
  POST as internalCalculateFee,
  _setDeps as setInternalDeps,
} from '../app/api/platform/internal/calculate-fee/route';

// ---------------------------------------------------------------------------
// Mock DbAdapter + ServiceDeps
// ---------------------------------------------------------------------------
const mockDb = {
  query: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
};

const mockDeps = () => ({ db: mockDb });

beforeAll(() => {
  // Nastav prázdné deps factory pro všechny routes — service je mockován,
  // takže deps se nikdy skutečně nepoužijí
  setAdminListDeps(mockDeps);
  setAdminScheduleDeps(mockDeps);
  setPromoterDeps(mockDeps);
  setInternalDeps(mockDeps);

  // Nastav service token pro interní endpoint
  process.env.INTERNAL_SERVICE_TOKEN = 'secret-token';
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeRequest(
  method: string,
  url: string,
  headers: Record<string, string> = {},
  body?: unknown,
): NextRequest {
  const init: RequestInit = {
    method,
    headers: { 'content-type': 'application/json', ...headers },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new NextRequest(url, init);
}

const FAKE_SCHEDULE = {
  id: 'sch-001',
  promoterId: 'prm-001',
  name: 'default',
  percentageFee: 500,
  fixedFee: 0,
  minFee: null,
  maxFee: null,
  validFrom: '2025-01-01T00:00:00.000Z',
  validUntil: null,
  isActive: true,
  createdAt: '2025-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// POST /admin/fee-schedules
// ---------------------------------------------------------------------------
describe('POST /api/platform/admin/fee-schedules', () => {
  beforeEach(() => {
    vi.mocked(feeService.createFeeSchedule).mockResolvedValue(FAKE_SCHEDULE);
  });

  it('vrátí 201 s validními daty', async () => {
    const req = makeRequest(
      'POST',
      'http://localhost/api/platform/admin/fee-schedules',
      { 'x-admin-user-id': 'admin-001' },
      {
        promoterId: '550e8400-e29b-41d4-a716-446655440000',
        percentageFee: 500,
        fixedFee: 0,
      },
    );
    const res = await adminPostSchedule(req);
    expect(res.status).toBe(201);
  });

  it('vrátí 400 pokud percentageFee > 10000', async () => {
    const req = makeRequest(
      'POST',
      'http://localhost/api/platform/admin/fee-schedules',
      { 'x-admin-user-id': 'admin-001' },
      {
        promoterId: '550e8400-e29b-41d4-a716-446655440000',
        percentageFee: 10001,
        fixedFee: 0,
      },
    );
    const res = await adminPostSchedule(req);
    expect(res.status).toBe(400);
  });

  it('vrátí 400 pokud minFee > maxFee', async () => {
    const req = makeRequest(
      'POST',
      'http://localhost/api/platform/admin/fee-schedules',
      { 'x-admin-user-id': 'admin-001' },
      {
        promoterId: '550e8400-e29b-41d4-a716-446655440000',
        percentageFee: 500,
        fixedFee: 0,
        minFee: 1000,
        maxFee: 500,
      },
    );
    const res = await adminPostSchedule(req);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /admin/fee-schedules
// ---------------------------------------------------------------------------
describe('GET /api/platform/admin/fee-schedules', () => {
  beforeEach(() => {
    vi.mocked(feeService.listFeeSchedules).mockResolvedValue([FAKE_SCHEDULE]);
  });

  it('vrátí 200 se seznamem schedules', async () => {
    const req = makeRequest(
      'GET',
      'http://localhost/api/platform/admin/fee-schedules?promoterId=550e8400-e29b-41d4-a716-446655440000',
      { 'x-admin-user-id': 'admin-001' },
    );
    const res = await adminGetSchedules(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
    expect(json).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// DELETE /admin/fee-schedules/[scheduleId]
// ---------------------------------------------------------------------------
describe('DELETE /api/platform/admin/fee-schedules/[scheduleId]', () => {
  beforeEach(() => {
    vi.mocked(feeService.deactivateFeeSchedule).mockResolvedValue(undefined);
  });

  it('vrátí 204 při soft deaktivaci', async () => {
    const req = makeRequest(
      'DELETE',
      'http://localhost/api/platform/admin/fee-schedules/sch-001',
      { 'x-admin-user-id': 'admin-001' },
    );
    const res = await adminDeleteSchedule(req, { params: { scheduleId: 'sch-001' } });
    expect(res.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// GET /promoters/[promoterId]/fee-schedule
// ---------------------------------------------------------------------------
describe('GET /api/platform/promoters/[promoterId]/fee-schedule', () => {
  beforeEach(() => {
    vi.mocked(feeService.getActiveFeeSchedule).mockResolvedValue(FAKE_SCHEDULE);
  });

  it('vrátí 200 s veřejnými poli aktivního schedule', async () => {
    const req = makeRequest(
      'GET',
      'http://localhost/api/platform/promoters/prm-001/fee-schedule',
      { 'x-user-id': 'user-001' },
    );
    const res = await promoterGetSchedule(req, { params: { promoterId: 'prm-001' } });
    expect(res.status).toBe(200);
    const json = await res.json();
    // Musí obsahovat veřejná pole
    expect(json).toHaveProperty('id');
    expect(json).toHaveProperty('percentageFee');
    expect(json).toHaveProperty('name');
    // Nesmí obsahovat admin pole
    expect(json).not.toHaveProperty('isActive');
    expect(json).not.toHaveProperty('promoterId');
    expect(json).not.toHaveProperty('createdAt');
  });
});

// ---------------------------------------------------------------------------
// POST /internal/calculate-fee
// ---------------------------------------------------------------------------
describe('POST /api/platform/internal/calculate-fee', () => {
  const FAKE_ORDER_RESULT = {
    lineItems: [],
    totalPlatformFee: 500,
    totalPromoterPayout: 9_500,
    totalGrossRevenue: 10_000,
    feeScheduleId: 'sch-001',
  };

  beforeEach(() => {
    vi.mocked(feeService.calculateOrderFee).mockResolvedValue(FAKE_ORDER_RESULT);
  });

  it('vrátí 200 s OrderFeeResult pro validní požadavek', async () => {
    const req = makeRequest(
      'POST',
      'http://localhost/api/platform/internal/calculate-fee',
      { 'x-service-token': 'secret-token' },
      {
        promoterId: '550e8400-e29b-41d4-a716-446655440000',
        lineItems: [{ price: 10_000, quantity: 1 }],
      },
    );
    const res = await internalCalculateFee(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('totalPlatformFee', 500);
    expect(json).toHaveProperty('feeScheduleId', 'sch-001');
  });

  it('vrátí 400 při záporné ceně v lineItems', async () => {
    const req = makeRequest(
      'POST',
      'http://localhost/api/platform/internal/calculate-fee',
      { 'x-service-token': 'secret-token' },
      {
        promoterId: '550e8400-e29b-41d4-a716-446655440000',
        lineItems: [{ price: -100, quantity: 1 }],
      },
    );
    const res = await internalCalculateFee(req);
    expect(res.status).toBe(400);
  });
});
