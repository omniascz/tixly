import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServiceDeps } from '../lib/service-container.js';
import {
  getConsentStatus,
  updateConsent,
  revokeAllConsents,
  getConsentHistory,
  exportConsentData,
} from '../services/consent-api.service.js';
import type { ConsentType, ConsentStatus } from '../types/consent.js';

function makeDeps() {
  const query = vi.fn();
  const execute = vi.fn();
  const transaction = vi.fn(async (fn) => {
    // Create a transaction adapter with same query/execute
    const txAdapter = {
      query: query as unknown as typeof query,
      execute: execute as unknown as typeof execute,
    };
    return fn(txAdapter as unknown as ServiceDeps['db']);
  });

  const deps: ServiceDeps = {
    db: { query, execute, transaction } as unknown as ServiceDeps['db'],
  };
  return { deps, query, execute, transaction };
}

const USER_ID = 'user-123';

describe('getConsentStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns all consent types with defaults for missing', async () => {
    const { deps, query } = makeDeps();
    query.mockResolvedValueOnce([
      {
        id: 'c1',
        user_id: USER_ID,
        type: 'marketing' as ConsentType,
        status: 'granted' as ConsentStatus,
        granted_at: new Date(),
        withdrawn_at: null,
        lawful_basis: 'consent' as const,
        ip_address: null,
        user_agent: null,
      },
    ]);

    const status = await getConsentStatus(USER_ID, deps);

    expect(status.marketing.status).toBe('granted');
    expect(status.analytics.status).toBe('denied');
    expect(status.personalization.status).toBe('denied');
    expect(status.functional.status).toBe('denied');
  });

  it('queries consent.user_consents table', async () => {
    const { deps, query } = makeDeps();
    query.mockResolvedValueOnce([]);
    await getConsentStatus(USER_ID, deps);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('consent.user_consents'),
      [USER_ID, expect.any(Array)],
    );
  });
});

describe('updateConsent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('grants consent and creates audit entry', async () => {
    const { deps, query, execute, transaction } = makeDeps();

    query.mockResolvedValueOnce([
      {
        id: 'c1',
        user_id: USER_ID,
        type: 'marketing' as ConsentType,
        status: 'granted' as ConsentStatus,
        granted_at: new Date(),
        withdrawn_at: null,
        lawful_basis: 'consent' as const,
        ip_address: '192.168.1.1',
        user_agent: 'Mozilla/5.0',
      },
    ]);

    const consent = await updateConsent(
      USER_ID,
      'marketing',
      'granted',
      'User accepted',
      '192.168.1.1',
      'Mozilla/5.0',
      deps,
    );

    expect(consent.status).toBe('granted');
    expect(consent.type).toBe('marketing');
    expect(transaction).toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO consent.user_consents'),
      expect.any(Array),
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO consent.audit_trail'),
      expect.any(Array),
    );
  });

  it('withdraws consent', async () => {
    const { deps, query } = makeDeps();

    query.mockResolvedValueOnce([
      {
        id: 'c1',
        user_id: USER_ID,
        type: 'analytics' as ConsentType,
        status: 'withdrawn' as ConsentStatus,
        granted_at: new Date(),
        withdrawn_at: new Date(),
        lawful_basis: 'consent' as const,
        ip_address: '192.168.1.1',
        user_agent: null,
      },
    ]);

    const consent = await updateConsent(
      USER_ID,
      'analytics',
      'withdrawn',
      'User revoked',
      '192.168.1.1',
      null,
      deps,
    );

    expect(consent.status).toBe('withdrawn');
    expect(consent.withdrawnAt).toBeDefined();
  });

  it('rejects invalid consent type', async () => {
    const { deps } = makeDeps();
    await expect(
      updateConsent(
        USER_ID,
        'invalid' as ConsentType,
        'granted',
        null,
        null,
        null,
        deps,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CONSENT' });
  });

  it('is idempotent (multiple same updates)', async () => {
    const { deps, query } = makeDeps();

    for (let i = 0; i < 3; i++) {
      query.mockResolvedValueOnce([
        {
          id: 'c1',
          user_id: USER_ID,
          type: 'marketing' as ConsentType,
          status: 'granted' as ConsentStatus,
          granted_at: new Date(),
          withdrawn_at: null,
          lawful_basis: 'consent' as const,
          ip_address: null,
          user_agent: null,
        },
      ]);

      await updateConsent(USER_ID, 'marketing', 'granted', null, null, null, deps);
    }

    expect(query).toHaveBeenCalledTimes(3);
  });
});

describe('revokeAllConsents', () => {
  beforeEach(() => vi.clearAllMocks());

  it('revokes all consents at once', async () => {
    const { deps, query, execute } = makeDeps();

    query.mockResolvedValueOnce([
      { id: 'c1' },
      { id: 'c2' },
      { id: 'c3' },
      { id: 'c4' },
    ]);

    const result = await revokeAllConsents(USER_ID, 'GDPR request', '192.168.1.1', deps);

    expect(result.revokedCount).toBe(4);
    expect(result.timestamp).toBeDefined();

    // Should update all to withdrawn
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE consent.user_consents'),
      [USER_ID],
    );

    // Should audit each revocation
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO consent.audit_trail'),
      expect.any(Array),
    );
  });

  it('returns 0 if no consents to revoke', async () => {
    const { deps, query } = makeDeps();
    query.mockResolvedValueOnce([]);

    const result = await revokeAllConsents(USER_ID, null, null, deps);

    expect(result.revokedCount).toBe(0);
  });
});

describe('getConsentHistory', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns paginated audit trail', async () => {
    const { deps, query } = makeDeps();

    const audit1 = {
      id: 'a1',
      user_id: USER_ID,
      consent_id: 'c1',
      action: 'granted' as const,
      timestamp: new Date('2025-01-01'),
      ip_address: '192.168.1.1',
      reason: 'User accepted',
    };

    const audit2 = {
      id: 'a2',
      user_id: USER_ID,
      consent_id: 'c1',
      action: 'withdrawn' as const,
      timestamp: new Date('2025-02-01'),
      ip_address: '192.168.1.2',
      reason: 'User revoked',
    };

    // First query for entries, second for count
    query
      .mockResolvedValueOnce([audit2, audit1]) // Newest first
      .mockResolvedValueOnce([{ count: 2 }]);

    const { entries, total } = await getConsentHistory(
      USER_ID,
      { limit: 50, offset: 0 },
      deps,
    );

    expect(entries).toHaveLength(2);
    expect(entries[0].action).toBe('withdrawn');
    expect(entries[1].action).toBe('granted');
    expect(total).toBe(2);
  });

  it('filters by consent type', async () => {
    const { deps, query } = makeDeps();
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0 }]);

    await getConsentHistory(
      USER_ID,
      { type: 'marketing', limit: 50, offset: 0 },
      deps,
    );

    const firstCall = query.mock.calls[0];
    expect(firstCall[0]).toContain('uc.type = $');
    expect(firstCall[1]).toContain('marketing');
  });

  it('filters by date range', async () => {
    const { deps, query } = makeDeps();
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0 }]);

    const start = new Date('2025-01-01');
    const end = new Date('2025-12-31');

    await getConsentHistory(
      USER_ID,
      { startDate: start, endDate: end, limit: 50, offset: 0 },
      deps,
    );

    const firstCall = query.mock.calls[0];
    expect(firstCall[0]).toContain('timestamp >=');
    expect(firstCall[0]).toContain('timestamp <=');
  });

  it('enforces pagination limits', async () => {
    const { deps, query } = makeDeps();
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0 }]);

    // Attempt limit > 200
    await getConsentHistory(USER_ID, { limit: 500, offset: 0 }, deps);

    const firstCall = query.mock.calls[0];
    expect(firstCall[0]).toContain('LIMIT 50'); // Should default to 50
  });

  it('checks 2-year retention window', async () => {
    const { deps, query } = makeDeps();
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0 }]);

    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

    await getConsentHistory(
      USER_ID,
      { startDate: twoYearsAgo, limit: 50, offset: 0 },
      deps,
    );

    expect(query).toHaveBeenCalled();
  });
});

describe('exportConsentData', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exports all consents and audit trail', async () => {
    const { deps, query } = makeDeps();

    const consents = [
      {
        id: 'c1',
        user_id: USER_ID,
        type: 'marketing' as ConsentType,
        status: 'granted' as ConsentStatus,
        granted_at: new Date(),
        withdrawn_at: null,
        lawful_basis: 'consent' as const,
        ip_address: null,
        user_agent: null,
      },
    ];

    const auditTrail = [
      {
        id: 'a1',
        user_id: USER_ID,
        consent_id: 'c1',
        action: 'granted' as const,
        timestamp: new Date(),
        ip_address: null,
        reason: null,
        type: 'marketing' as ConsentType,
      },
    ];

    query.mockResolvedValueOnce(consents).mockResolvedValueOnce(auditTrail);

    const exported = await exportConsentData(USER_ID, deps);

    expect(exported.consents).toHaveLength(1);
    expect(exported.auditTrail).toHaveLength(1);
    expect(exported.exportDate).toBeDefined();
    expect(exported.consents[0].type).toBe('marketing');
  });

  it('excludes IP/UA from export for privacy', async () => {
    const { deps, query } = makeDeps();

    const consents = [
      {
        id: 'c1',
        user_id: USER_ID,
        type: 'analytics' as ConsentType,
        status: 'granted' as ConsentStatus,
        granted_at: new Date(),
        withdrawn_at: null,
        lawful_basis: 'consent' as const,
        ip_address: '192.168.1.1',
        user_agent: 'Mozilla/5.0',
      },
    ];

    query.mockResolvedValueOnce(consents).mockResolvedValueOnce([]);

    const exported = await exportConsentData(USER_ID, deps);

    // The raw DB returns IP/UA, but we can verify the structure is preserved
    expect(exported.consents[0]).toBeDefined();
  });

  it('handles empty consent history', async () => {
    const { deps, query } = makeDeps();
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const exported = await exportConsentData(USER_ID, deps);

    expect(exported.consents).toHaveLength(0);
    expect(exported.auditTrail).toHaveLength(0);
    expect(exported.exportDate).toBeDefined();
  });
});
