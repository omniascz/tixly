import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServiceDeps } from '../lib/service-container.js';
import {
  DEFAULT_BANNER,
  getBannerConfig,
  isConsentValid,
  recordConsent,
} from '../services/consent.service.js';

function makeDeps() {
  const query = vi.fn();
  const execute = vi.fn();
  const transaction = vi.fn();
  const deps: ServiceDeps = {
    db: { query, execute, transaction } as unknown as ServiceDeps['db'],
  };
  return { deps, query, execute };
}

const PROMOTER = 'promoter-1';

describe('getBannerConfig', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns default when no row exists', async () => {
    const { deps, query } = makeDeps();
    query.mockResolvedValueOnce([]);
    const config = await getBannerConfig(PROMOTER, deps);
    expect(config.title).toBe(DEFAULT_BANNER.title);
    expect(config.promoterId).toBe(PROMOTER);
    expect(config.categories).toHaveLength(4);
  });

  it('returns stored config when row exists', async () => {
    const { deps, query } = makeDeps();
    query.mockResolvedValueOnce([
      {
        promoter_id: PROMOTER,
        config: { ...DEFAULT_BANNER, title: 'Custom' },
        updated_at: new Date(),
      },
    ]);
    const config = await getBannerConfig(PROMOTER, deps);
    expect(config.title).toBe('Custom');
  });
});

describe('recordConsent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts record and returns it', async () => {
    const { deps, query } = makeDeps();
    query.mockResolvedValueOnce([
      {
        id: 'r1',
        promoter_id: PROMOTER,
        visitor_id: 'v1',
        consents: { necessary: true, functional: false, analytics: true, marketing: false },
        ip_hash: null,
        user_agent: null,
        banner_version: '1.0.0',
        consented_at: new Date(),
        expires_at: new Date(Date.now() + 1000),
      },
    ]);
    const rec = await recordConsent(
      {
        promoterId: PROMOTER,
        visitorId: 'v1',
        consents: { analytics: true },
        bannerVersion: '1.0.0',
      },
      deps,
    );
    expect(rec.id).toBe('r1');
    expect(query.mock.calls[0]?.[0]).toContain('INSERT INTO consent.records');
  });

  it('rejects invalid input (missing visitor)', async () => {
    const { deps } = makeDeps();
    await expect(
      recordConsent(
        {
          promoterId: PROMOTER,
          visitorId: '',
          consents: {},
          bannerVersion: '1.0.0',
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CONSENT' });
  });
});

describe('isConsentValid', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns false if no record', async () => {
    const { deps, query } = makeDeps();
    query.mockResolvedValueOnce([]); // getConsent
    const valid = await isConsentValid('v1', PROMOTER, deps);
    expect(valid).toBe(false);
  });

  it('returns false if expired', async () => {
    const { deps, query } = makeDeps();
    query.mockResolvedValueOnce([
      {
        id: 'r1',
        promoter_id: PROMOTER,
        visitor_id: 'v1',
        consents: {},
        ip_hash: null,
        user_agent: null,
        banner_version: '1.0.0',
        consented_at: new Date(),
        expires_at: new Date(Date.now() - 1000),
      },
    ]);
    const valid = await isConsentValid('v1', PROMOTER, deps);
    expect(valid).toBe(false);
  });

  it('returns false on version mismatch', async () => {
    const { deps, query } = makeDeps();
    query
      .mockResolvedValueOnce([
        {
          id: 'r1',
          promoter_id: PROMOTER,
          visitor_id: 'v1',
          consents: {},
          ip_hash: null,
          user_agent: null,
          banner_version: '0.9.0',
          consented_at: new Date(),
          expires_at: new Date(Date.now() + 10000),
        },
      ])
      .mockResolvedValueOnce([]); // getBannerConfig → default 1.0.0
    const valid = await isConsentValid('v1', PROMOTER, deps);
    expect(valid).toBe(false);
  });

  it('returns true when valid and version matches', async () => {
    const { deps, query } = makeDeps();
    query
      .mockResolvedValueOnce([
        {
          id: 'r1',
          promoter_id: PROMOTER,
          visitor_id: 'v1',
          consents: {},
          ip_hash: null,
          user_agent: null,
          banner_version: '1.0.0',
          consented_at: new Date(),
          expires_at: new Date(Date.now() + 10000),
        },
      ])
      .mockResolvedValueOnce([]);
    const valid = await isConsentValid('v1', PROMOTER, deps);
    expect(valid).toBe(true);
  });
});
