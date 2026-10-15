/**
 * Kolo 19 / krok 2 — Sentry 11: spany (span streaming) obcházejí beforeSend → maskování i v beforeSendSpan; telefon
 * v URL-kódovaném dotazu (%2B420%20777…) se maskuje; sběr dat (dataCollection) je explicitně restriktivní.
 * Zjištěno proti simulátoru (logs/r19/2_red.txt): span nesl http.request.header.cookie s e-mailem a user.ip_address,
 * událost telefon v query_string. Testovací data jako tests/r14-sentry-scrub.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { SENTRY_DATA_COLLECTION, scrubSentrySpan, scrubText } from '@/lib/observability/scrub-pii';

describe('scrubText — URL-kódované telefony', () => {
  it.each([
    ['tel=%2B420%20777%20123%20456', 'tel=[telefon]'],
    ['tel=777%20123%20456&x=1', 'tel=[telefon]&x=1'],
    ['tel=%2B420+777+123+456', 'tel=[telefon]'],
  ])('%s', (input, out) => { expect(scrubText(input)).toBe(out); });
  it('nechá UUID, částky a čísla objednávek', () => {
    const s = 'order 2f9084f6-8171-40c2-aecf-17f190d8a4f5 za 1 400 Kč, faktura 2026-0001, kód 482913, /api/x?page=2&limit=20';
    expect(scrubText(s)).toBe(s);
  });
});

describe('scrubSentrySpan', () => {
  it('odstraní hlavičky s identitou/tajemstvím, IP a uživatele kromě id; maskuje text', () => {
    const span = scrubSentrySpan({
      name: 'POST /api/checkout?email=jana%40x.cz',
      span_id: 'a1', trace_id: 't1', is_segment: true,
      attributes: {
        'sentry.op': 'http.server',
        'http.route': '/api/checkout',
        'url.full': 'http://localhost:3200/api/checkout?email=jana@x.cz&tel=%2B420%20777%20123%20456',
        'http.request.header.cookie': ['r19_buyer=jana%40x.cz'],
        'http.request.header.authorization': '[Filtered]',
        'http.request.header.x_internal_token': 'abc',
        'http.request.header.x-user-id': 'u-1',
        'http.request.header.x_real_ip': '10.255.255.1',
        'http.request.header.x_forwarded_for': ['10.255.255.1'],
        'http.request.header.user_agent': ['Mozilla/5.0'],
        'client.address': '10.255.255.1',
        'user.ip_address': '10.255.255.1',
        'user.email': 'jana@x.cz',
        'user.id': 'u-1',
        'db.query.text': 'select * from x where email = \'jana@x.cz\'',
        'http.response.status_code': 500,
      },
    });
    expect(Object.keys(span.attributes).sort()).toEqual([
      'db.query.text', 'http.request.header.user_agent', 'http.response.status_code', 'http.route', 'sentry.op', 'url.full', 'user.id',
    ]);
    expect(JSON.stringify(span)).not.toMatch(/jana(@|%40)x\.cz|777|10\.255\.255\.1/);
    expect(span.name).toBe('POST /api/checkout?email=[email]');
    expect(span.attributes['user.id']).toBe('u-1');
    expect(span.attributes['http.response.status_code']).toBe(500);
    expect(span.attributes['http.request.header.user_agent']).toEqual(['Mozilla/5.0']);
  });
});

describe('SENTRY_DATA_COLLECTION — restriktivní sběr (MIGRATION.md 10→11: chování v10)', () => {
  it('bez uživatele, cookies, těl, GenAI, dotazů DB, front a GraphQL', () => {
    expect(SENTRY_DATA_COLLECTION).toMatchObject({
      userInfo: false, cookies: false, httpBodies: [], genAI: { inputs: false, outputs: false },
      databaseQueryData: false, queues: false, graphQL: { document: false, variables: false },
    });
  });
  it('hlavičky: odmítnuté IP, identita a tajemství', () => {
    const deny = (SENTRY_DATA_COLLECTION.httpHeaders.request as { deny: string[] }).deny;
    for (const h of ['forwarded', '-ip', 'remote-', 'via', '-user', 'authorization', 'cookie', 'x-internal-token', 'x-user-id']) expect(deny).toContain(h);
  });
});
