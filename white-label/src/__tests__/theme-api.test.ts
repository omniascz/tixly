import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Mock dns module for domain verification tests
vi.mock('dns', () => ({
  promises: {
    resolveTxt: vi.fn(),
  },
}));

import { promises as dns } from 'dns';
import { GET as getTheme, PUT as putTheme } from '../app/api/platform/themes/route';
import {
  GET as getDomains,
  POST as postDomain,
} from '../app/api/platform/themes/domains/route';
import { DELETE as deleteDomainRoute } from '../app/api/platform/themes/domains/[domainId]/route';
import { POST as verifyDomainRoute } from '../app/api/platform/themes/domains/[domainId]/verify/route';
import type { ThemeDeps } from '../services/theme.service';
import type { DomainDeps } from '../services/domain.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDb(queryResults: unknown[][] = []) {
  let idx = 0;
  return {
    query: vi.fn().mockImplementation(() => Promise.resolve(queryResults[idx++] ?? [])),
    execute: vi.fn().mockResolvedValue(undefined),
  };
}

function makeRedis() {
  const store = new Map<string, string>();
  return {
    get: vi.fn().mockImplementation(async (key: string) => store.get(key) ?? null),
    set: vi.fn().mockImplementation(async (key: string, value: string) => { store.set(key, value); }),
    del: vi.fn().mockImplementation(async (key: string) => { store.delete(key); }),
  };
}

function makeThemeRequest(method: string, body?: unknown, promoterId = 'promo-123'): NextRequest {
  const req = new NextRequest('http://localhost/api/platform/themes', {
    method,
    headers: {
      'x-promoter-id': promoterId,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return req;
}

function makeDomainRequest(
  method: string,
  body?: unknown,
  promoterId = 'promo-123',
): NextRequest {
  return new NextRequest('http://localhost/api/platform/themes/domains', {
    method,
    headers: {
      'x-promoter-id': promoterId,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const THEME_ROW = {
  promoter_id: 'promo-123',
  logo_url: 'https://example.com/logo.png',
  favicon_url: null,
  hero_image_url: null,
  primary_color: '#6366f1',
  secondary_color: '#4f46e5',
  accent_color: '#f59e0b',
  font_family: null,
  footer_text: null,
  powered_by_hidden: false,
  custom_css: null,
  plan_tier: 'starter',
};

const DOMAIN_ROW = {
  id: 'domain-uuid-1',
  promoter_id: 'promo-123',
  domain: 'vstupenky.slaviapraha.cz',
  status: 'pending',
  ssl_status: 'pending',
  verified_at: null,
  ssl_provisioned_at: null,
  verification_token: 'abc123token',
  verification_attempts: 0,
};

// ── Theme API Tests ───────────────────────────────────────────────────────────

describe('theme-api: GET /themes', () => {
  it('1. GET /themes vrátí theme pro platného promotéra', async () => {
    const db = makeDb([[THEME_ROW]]);
    const redis = makeRedis();
    const deps: ThemeDeps = { db, redis };

    const res = await getTheme(makeThemeRequest('GET'), { deps });
    const data = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(data['promoterId']).toBe('promo-123');
    expect(data['primaryColor']).toBe('#6366f1');
  });

  it('2. GET /themes 401 bez x-promoter-id headeru', async () => {
    const db = makeDb();
    const redis = makeRedis();
    const deps: ThemeDeps = { db, redis };

    const req = new NextRequest('http://localhost/api/platform/themes', { method: 'GET' });
    const res = await getTheme(req, { deps });

    expect(res.status).toBe(401);
    const data = await res.json() as Record<string, unknown>;
    expect(data['error']).toBe('UNAUTHORIZED');
  });

  it('3. GET /themes vrátí DEFAULT_THEME pokud promoter nemá theme', async () => {
    const db = makeDb([[]]); // prázdný výsledek → žádný záznam
    const redis = makeRedis();
    const deps: ThemeDeps = { db, redis };

    const res = await getTheme(makeThemeRequest('GET'), { deps });
    const data = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(data['promoterId']).toBe('promo-123');
    expect(data['primaryColor']).toBe('#6366f1'); // DEFAULT_THEME fallback
  });
});

describe('theme-api: PUT /themes', () => {
  it('4. PUT /themes uloží logo + primaryColor pro starter plan', async () => {
    const planRow = { plan_tier: 'starter' };
    const updatedRow = { ...THEME_ROW, logo_url: 'https://cdn.test.com/logo.png' };
    // 1. query: plan lookup; 2. query: re-fetch after save (redis miss)
    const db = makeDb([[planRow], [updatedRow]]);
    const redis = makeRedis();
    const deps: ThemeDeps = { db, redis };

    const res = await putTheme(
      makeThemeRequest('PUT', {
        logoUrl: 'https://cdn.test.com/logo.png',
        primaryColor: '#ff0000',
      }),
      { deps },
    );

    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data['logoUrl']).toBe('https://cdn.test.com/logo.png');
  });

  it('5. PUT /themes 400 pro neplatnou hex barvu', async () => {
    const db = makeDb();
    const redis = makeRedis();
    const deps: ThemeDeps = { db, redis };

    const res = await putTheme(
      makeThemeRequest('PUT', { primaryColor: 'red' }),
      { deps },
    );

    expect(res.status).toBe(400);
    const data = await res.json() as Record<string, unknown>;
    expect(data['error']).toBe('VALIDATION_ERROR');
  });

  it('6. PUT /themes 422 pro secondaryColor na starter plánu', async () => {
    const db = makeDb([[{ plan_tier: 'starter' }]]);
    const redis = makeRedis();
    const deps: ThemeDeps = { db, redis };

    const res = await putTheme(
      makeThemeRequest('PUT', { secondaryColor: '#ff0000' }),
      { deps },
    );

    expect(res.status).toBe(422);
    const data = await res.json() as Record<string, unknown>;
    expect(data['error']).toBe('PLAN_FEATURE_NOT_AVAILABLE');
  });

  it('7. PUT /themes 400 pro invalid JSON', async () => {
    const db = makeDb();
    const redis = makeRedis();
    const deps: ThemeDeps = { db, redis };

    const req = new NextRequest('http://localhost/api/platform/themes', {
      method: 'PUT',
      headers: { 'x-promoter-id': 'promo-123', 'content-type': 'application/json' },
      body: 'not-json{{{',
    });
    const res = await putTheme(req, { deps });

    expect(res.status).toBe(400);
    const data = await res.json() as Record<string, unknown>;
    expect(data['error']).toBe('INVALID_JSON');
  });

  it('8. PUT /themes 401 bez headeru', async () => {
    const db = makeDb();
    const redis = makeRedis();
    const deps: ThemeDeps = { db, redis };

    const req = new NextRequest('http://localhost/api/platform/themes', {
      method: 'PUT',
      body: JSON.stringify({ primaryColor: '#ff0000' }),
    });
    const res = await putTheme(req, { deps });

    expect(res.status).toBe(401);
  });
});

// ── Domain API Tests ──────────────────────────────────────────────────────────

describe('theme-api: POST /domains', () => {
  it('9. POST /domains vytvoří doménu pro pro plan', async () => {
    const db = makeDb([[{ plan_tier: 'pro' }], [DOMAIN_ROW]]);
    const redis = makeRedis();
    const deps: DomainDeps = { db, redis };

    const res = await postDomain(
      makeDomainRequest('POST', { domain: 'vstupenky.slaviapraha.cz' }),
      { deps },
    );

    expect(res.status).toBe(201);
    const data = await res.json() as Record<string, unknown>;
    expect(data['domain']).toBe('vstupenky.slaviapraha.cz');
  });

  it('10. POST /domains 422 pro starter plan (nedovoleno)', async () => {
    const db = makeDb([[{ plan_tier: 'starter' }]]);
    const redis = makeRedis();
    const deps: DomainDeps = { db, redis };

    const res = await postDomain(
      makeDomainRequest('POST', { domain: 'mysite.cz' }),
      { deps },
    );

    expect(res.status).toBe(422);
    const data = await res.json() as Record<string, unknown>;
    expect(data['error']).toBe('PLAN_FEATURE_NOT_AVAILABLE');
  });

  it('11. POST /domains 409 pro duplicitní doménu', async () => {
    // Plan check passes, but insert returns empty (conflict)
    const db = makeDb([[{ plan_tier: 'pro' }], []]);
    const redis = makeRedis();
    const deps: DomainDeps = { db, redis };

    const res = await postDomain(
      makeDomainRequest('POST', { domain: 'dupe.example.cz' }),
      { deps },
    );

    expect(res.status).toBe(409);
    const data = await res.json() as Record<string, unknown>;
    expect(data['error']).toBe('DOMAIN_ALREADY_TAKEN');
  });

  it('12. POST /domains 422 pro neplatný formát domény (znaky mimo whitelist)', async () => {
    const db = makeDb([[{ plan_tier: 'pro' }]]);
    const redis = makeRedis();
    const deps: DomainDeps = { db, redis };

    // Doména s podtržítkem — projde Zod (min 4, max 253), ale selže v service regex
    const res = await postDomain(
      makeDomainRequest('POST', { domain: 'bad_domain!cz' }),
      { deps },
    );

    expect(res.status).toBe(422);
    const data = await res.json() as Record<string, unknown>;
    expect(data['error']).toBe('INVALID_DOMAIN');
  });
});

describe('theme-api: POST /domains/[id]/verify', () => {
  it('13. POST /domains/[id]/verify vrátí verified=true pokud DNS odpovídá', async () => {
    const token = 'test-token-abc';
    const domainRowWithToken = { ...DOMAIN_ROW, verification_token: token, status: 'pending' };
    const verifiedRow = { ...domainRowWithToken, status: 'verified', verified_at: new Date().toISOString() };
    const db = makeDb([[domainRowWithToken], [verifiedRow]]);
    const redis = makeRedis();
    const deps: DomainDeps = { db, redis };

    vi.mocked(dns.resolveTxt).mockResolvedValueOnce([[`tixly-verify=${token}`]]);

    const req = new NextRequest('http://localhost/api/platform/themes/domains/domain-uuid-1/verify', {
      method: 'POST',
      headers: { 'x-promoter-id': 'promo-123' },
    });
    const res = await verifyDomainRoute(req, { params: { domainId: 'domain-uuid-1' }, deps });

    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data['verified']).toBe(true);
  });

  it('14. POST /domains/[id]/verify vrátí verified=false pokud DNS neodpovídá', async () => {
    const domainRow = { ...DOMAIN_ROW, verification_token: 'token-xyz', status: 'pending' };
    const unchangedRow = { ...domainRow };
    const db = makeDb([[domainRow], [unchangedRow]]);
    const redis = makeRedis();
    const deps: DomainDeps = { db, redis };

    vi.mocked(dns.resolveTxt).mockResolvedValueOnce([['wrong-token']]);

    const req = new NextRequest('http://localhost/api/platform/themes/domains/domain-uuid-1/verify', {
      method: 'POST',
      headers: { 'x-promoter-id': 'promo-123' },
    });
    const res = await verifyDomainRoute(req, { params: { domainId: 'domain-uuid-1' }, deps });

    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data['verified']).toBe(false);
  });

  it('15. POST /domains/[id]/verify 404 pro neexistující doménu', async () => {
    const db = makeDb([[]]); // prázdný výsledek → doména nenalezena
    const redis = makeRedis();
    const deps: DomainDeps = { db, redis };

    vi.mocked(dns.resolveTxt).mockRejectedValueOnce(new Error('ENOTFOUND'));

    const req = new NextRequest('http://localhost/api/platform/themes/domains/nonexistent/verify', {
      method: 'POST',
      headers: { 'x-promoter-id': 'promo-123' },
    });
    const res = await verifyDomainRoute(req, { params: { domainId: 'nonexistent' }, deps });

    expect(res.status).toBe(404);
  });
});

describe('theme-api: DELETE /domains/[id]', () => {
  it('16. DELETE /domains/[id] smaže doménu a Redis klíč', async () => {
    const db = makeDb([[{ domain: 'vstupenky.slaviapraha.cz' }]]);
    const redis = makeRedis();
    const deps: DomainDeps = { db, redis };

    const req = new NextRequest('http://localhost/api/platform/themes/domains/domain-uuid-1', {
      method: 'DELETE',
      headers: { 'x-promoter-id': 'promo-123' },
    });
    const res = await deleteDomainRoute(req, { params: { domainId: 'domain-uuid-1' }, deps });

    expect(res.status).toBe(204);
    expect(redis.del).toHaveBeenCalledWith('domain:vstupenky.slaviapraha.cz');
  });

  it('17. DELETE /domains/[id] 404 pro cizí doménu', async () => {
    const db = makeDb([[]]); // SELECT vrátí prázdno — cizí doména
    const redis = makeRedis();
    const deps: DomainDeps = { db, redis };

    const req = new NextRequest('http://localhost/api/platform/themes/domains/other-id', {
      method: 'DELETE',
      headers: { 'x-promoter-id': 'promo-123' },
    });
    const res = await deleteDomainRoute(req, { params: { domainId: 'other-id' }, deps });

    expect(res.status).toBe(404);
  });
});

describe('theme-api: GET /domains', () => {
  it('18. GET /domains vrátí seznam domén promotéra', async () => {
    const db = makeDb([[DOMAIN_ROW, { ...DOMAIN_ROW, id: 'domain-uuid-2', domain: 'other.cz' }]]);
    const redis = makeRedis();
    const deps: DomainDeps = { db, redis };

    const req = new NextRequest('http://localhost/api/platform/themes/domains', {
      method: 'GET',
      headers: { 'x-promoter-id': 'promo-123' },
    });
    const res = await getDomains(req, { deps });

    expect(res.status).toBe(200);
    const data = await res.json() as unknown[];
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(2);
  });
});
