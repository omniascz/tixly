import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createTenant, getTenant, getTenantByKey, listTenants, deleteTenant, extendTenant,
} from '../services/tenant.service.js';
import { seedTenant, resetTenant, listScenarios, SCENARIOS } from '../services/seed.service.js';
import {
  processMockPayment, sendMockEmail, getMockInbox, clearMockInbox,
  sendMockSms, getMockSmsLog, clearMockSmsLog,
} from '../services/mock-services.service.js';
import { SandboxError, isSandboxError } from '../lib/sandbox-errors.js';

function makeDb(rows: unknown[][] = []) {
  let idx = 0;
  return {
    query: vi.fn().mockImplementation(() => Promise.resolve({ rows: rows[idx++] ?? [] })),
    execute: vi.fn().mockResolvedValue(undefined),
  };
}

const TENANT = {
  id: 't-1',
  name: 'Dev Sandbox',
  ownerEmail: 'dev@example.com',
  sandboxKey: 'sbx_abc123',
  schemaPrefix: 'sbx_def456',
  expiresAt: new Date(Date.now() + 30 * 86400000),
  createdAt: new Date(),
  isActive: true,
};

// ---------------------------------------------------------------------------
// Tenant management
// ---------------------------------------------------------------------------
describe('createTenant', () => {
  it('creates a new tenant with 30-day default lifetime', async () => {
    const db = makeDb([
      [{ cnt: '0' }],   // no existing tenants for owner
      [TENANT],          // insert
    ]);
    const r = await createTenant({ name: 'Dev Sandbox', ownerEmail: 'dev@example.com' }, db);
    expect(r.sandboxKey).toMatch(/^sbx_/);
    expect(r.schemaPrefix).toMatch(/^sbx_/);
  });

  it('lowercases owner email', async () => {
    const db = makeDb([[{ cnt: '0' }], [TENANT]]);
    await createTenant({ name: 'X', ownerEmail: 'Dev@EXAMPLE.com' }, db);
    const params = db.query.mock.calls[1][1] as unknown[];
    expect(params[1]).toBe('dev@example.com');
  });

  it('rejects when per-owner limit reached', async () => {
    const db = makeDb([[{ cnt: '5' }]]);  // already at limit
    await expect(createTenant({ name: 'X', ownerEmail: 'a@b.com' }, db))
      .rejects.toMatchObject({ code: 'TENANT_LIMIT_REACHED' });
  });

  it('respects custom lifetimeDays', async () => {
    const db = makeDb([[{ cnt: '0' }], [TENANT]]);
    await createTenant({ name: 'X', ownerEmail: 'a@b.com', lifetimeDays: 7 }, db);
    const insertParams = db.query.mock.calls[1][1] as unknown[];
    const expiresAt = new Date(insertParams[4] as string);
    const days = Math.round((expiresAt.getTime() - Date.now()) / 86400000);
    expect(days).toBe(7);
  });
});

describe('getTenant', () => {
  it('returns tenant by id', async () => {
    const db = makeDb([[TENANT]]);
    const r = await getTenant('t-1', db);
    expect(r.name).toBe('Dev Sandbox');
  });

  it('throws when not found', async () => {
    const db = makeDb([[]]);
    await expect(getTenant('missing', db)).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });
});

describe('getTenantByKey', () => {
  it('returns active tenant by sandbox key', async () => {
    const db = makeDb([[TENANT]]);
    const r = await getTenantByKey('sbx_abc123', db);
    expect(r.id).toBe('t-1');
  });

  it('throws TENANT_EXPIRED for expired tenant', async () => {
    const db = makeDb([[{ ...TENANT, expiresAt: new Date(Date.now() - 1000) }]]);
    await expect(getTenantByKey('sbx_abc123', db))
      .rejects.toMatchObject({ code: 'TENANT_EXPIRED' });
  });

  it('throws TENANT_NOT_FOUND for inactive tenant', async () => {
    const db = makeDb([[{ ...TENANT, isActive: false }]]);
    await expect(getTenantByKey('sbx_abc123', db))
      .rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });
});

describe('listTenants', () => {
  it('lists tenants for owner', async () => {
    const db = makeDb([[TENANT]]);
    const r = await listTenants('dev@example.com', db);
    expect(r).toHaveLength(1);
  });
});

describe('deleteTenant', () => {
  it('soft-deletes tenant', async () => {
    const db = makeDb([[{ id: 't-1' }]]);
    await expect(deleteTenant('t-1', db)).resolves.toBeUndefined();
  });

  it('throws when not found', async () => {
    const db = makeDb([[]]);
    await expect(deleteTenant('missing', db)).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });
});

describe('extendTenant', () => {
  it('extends expiry by given days', async () => {
    const db = makeDb([[TENANT]]);
    const r = await extendTenant('t-1', 30, db);
    expect(r.id).toBe('t-1');
  });

  it('rejects invalid days range', async () => {
    const db = makeDb();
    await expect(extendTenant('t-1', 0, db)).rejects.toMatchObject({ code: 'INVALID_SCENARIO' });
    await expect(extendTenant('t-1', 400, db)).rejects.toMatchObject({ code: 'INVALID_SCENARIO' });
  });
});

// ---------------------------------------------------------------------------
// Seed service
// ---------------------------------------------------------------------------
describe('listScenarios', () => {
  it('returns all 3 scenarios', () => {
    const s = listScenarios();
    expect(s.map((x) => x.name).sort()).toEqual(['minimal', 'standard', 'stress']);
  });
});

describe('seedTenant', () => {
  it('creates minimal scenario data', async () => {
    // minimal: 1 event × 10 tickets, 2 users, 1 order
    const db: any = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'e1' }] })   // event
        .mockResolvedValueOnce({ rows: [{ id: 'u1' }] })   // user 1
        .mockResolvedValueOnce({ rows: [{ id: 'u2' }] }),  // user 2
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const r = await seedTenant('t-1', 'minimal', db);
    expect(r.eventsCreated).toBe(1);
    expect(r.ticketsCreated).toBe(10);
    expect(r.usersCreated).toBe(2);
    expect(r.ordersCreated).toBe(1);
    expect(r.apiKey).toMatch(/^sbx_api_/);
  });

  it('rejects unknown scenario', async () => {
    const db = makeDb();
    await expect(seedTenant('t-1', 'unknown', db)).rejects.toThrow();
  });

  it('scales ticket creation with scenario size', async () => {
    // standard: 5 events × 100 tickets
    const db: any = {
      query: vi.fn().mockImplementation(() => Promise.resolve({ rows: [{ id: 'id-' + Math.random() }] })),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const r = await seedTenant('t-1', 'standard', db);
    expect(r.eventsCreated).toBe(5);
    expect(r.ticketsCreated).toBe(500);
    expect(r.usersCreated).toBe(20);
  });
});

describe('resetTenant', () => {
  it('deletes all seeded data', async () => {
    const db = makeDb();
    await resetTenant('t-1', db);
    expect(db.execute).toHaveBeenCalledTimes(5);  // 5 tables
  });
});

// ---------------------------------------------------------------------------
// Mock payment
// ---------------------------------------------------------------------------
describe('processMockPayment', () => {
  const base = { amountHellers: 100000, currency: 'CZK', cardToken: '' };

  it('tok_success returns succeeded', () => {
    const r = processMockPayment({ ...base, cardToken: 'tok_success' });
    expect(r.status).toBe('succeeded');
    expect(r.id).toMatch(/^pay_mock_/);
  });

  it('tok_declined returns declined with reason', () => {
    const r = processMockPayment({ ...base, cardToken: 'tok_declined' });
    expect(r.status).toBe('declined');
    expect(r.declineReason).toBe('card_declined');
  });

  it('tok_insufficient returns insufficient_funds', () => {
    const r = processMockPayment({ ...base, cardToken: 'tok_insufficient' });
    expect(r.declineReason).toBe('insufficient_funds');
  });

  it('tok_3ds returns requires_action with redirect', () => {
    const r = processMockPayment({ ...base, cardToken: 'tok_3ds' });
    expect(r.status).toBe('requires_action');
    expect(r.threeDsRedirectUrl).toContain('/3ds/');
  });

  it('tok_fraud returns fraud', () => {
    const r = processMockPayment({ ...base, cardToken: 'tok_fraud' });
    expect(r.status).toBe('fraud');
  });

  it('tok_timeout throws', () => {
    expect(() => processMockPayment({ ...base, cardToken: 'tok_timeout' })).toThrow(SandboxError);
  });

  it('rejects zero amount', () => {
    expect(() => processMockPayment({ ...base, cardToken: 'tok_success', amountHellers: 0 }))
      .toThrow(SandboxError);
  });

  it('unknown token defaults to success', () => {
    const r = processMockPayment({ ...base, cardToken: 'tok_unknown_123' });
    expect(r.status).toBe('succeeded');
  });
});

// ---------------------------------------------------------------------------
// Mock email
// ---------------------------------------------------------------------------
describe('sendMockEmail', () => {
  beforeEach(() => clearMockInbox());

  it('sends and stores in inbox', () => {
    const r = sendMockEmail({ to: 'dev@example.com', subject: 'Hi', body: 'Test' });
    expect(r.status).toBe('sent');
    const inbox = getMockInbox('dev@example.com');
    expect(inbox).toHaveLength(1);
    expect(inbox[0].subject).toBe('Hi');
  });

  it('bounces emails to bounce@ address', () => {
    const r = sendMockEmail({ to: 'bounce@sandbox.example', subject: 'x', body: 'x' });
    expect(r.status).toBe('bounced');
  });

  it('is case-insensitive on recipient', () => {
    sendMockEmail({ to: 'Dev@Example.com', subject: 'x', body: 'x' });
    expect(getMockInbox('dev@example.com')).toHaveLength(1);
  });

  it('rejects missing subject', () => {
    expect(() => sendMockEmail({ to: 'a@b.com', subject: '', body: 'x' })).toThrow(SandboxError);
  });

  it('clearMockInbox wipes specific recipient', () => {
    sendMockEmail({ to: 'a@b.com', subject: 'x', body: 'x' });
    sendMockEmail({ to: 'c@d.com', subject: 'x', body: 'x' });
    clearMockInbox('a@b.com');
    expect(getMockInbox('a@b.com')).toHaveLength(0);
    expect(getMockInbox('c@d.com')).toHaveLength(1);
  });

  it('clearMockInbox with no arg wipes all', () => {
    sendMockEmail({ to: 'a@b.com', subject: 'x', body: 'x' });
    sendMockEmail({ to: 'c@d.com', subject: 'x', body: 'x' });
    clearMockInbox();
    expect(getMockInbox('a@b.com')).toHaveLength(0);
    expect(getMockInbox('c@d.com')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Mock SMS
// ---------------------------------------------------------------------------
describe('sendMockSms', () => {
  beforeEach(() => clearMockSmsLog());

  it('delivers to normal numbers', () => {
    const r = sendMockSms({ to: '+420777123456', body: 'Test' });
    expect(r.status).toBe('delivered');
    expect(getMockSmsLog()).toHaveLength(1);
  });

  it('fails to +0000... numbers', () => {
    const r = sendMockSms({ to: '+00001234567', body: 'Test' });
    expect(r.status).toBe('failed');
  });

  it('rejects missing body', () => {
    expect(() => sendMockSms({ to: '+420777123456', body: '' })).toThrow(SandboxError);
  });
});

// ---------------------------------------------------------------------------
// SandboxError
// ---------------------------------------------------------------------------
describe('SandboxError', () => {
  it('maps codes to status', () => {
    expect(new SandboxError('TENANT_EXPIRED').statusCode).toBe(410);
    expect(new SandboxError('TENANT_LIMIT_REACHED').statusCode).toBe(422);
    expect(new SandboxError('CARD_TEST_TOKEN').statusCode).toBe(402);
  });
  it('type guard works', () => {
    expect(isSandboxError(new SandboxError('TENANT_NOT_FOUND'))).toBe(true);
    expect(isSandboxError(new Error())).toBe(false);
  });
});
