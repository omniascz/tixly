/**
 * Kolo 21 / krok 2 — tokeny z URL (hlavička Referer, parametry dotazu) se nesmí dostat do Sentry.
 * Zjištěno proti simulátoru (logs/r21/2_red.txt): span nesl http.request.header.referer, http.target a next.span_name
 * s /cs/reset-password?token=… a /seats/kategorie?token=…, událost request.headers.referer. Hodnoty tokenů jsou smyšlené.
 * E2E ověření nad běžící aplikací: e2e/tests/golden-path-r21-sentry-url-tokens.spec.ts.
 */
import { describe, expect, it } from 'vitest';
import { SENTRY_DATA_COLLECTION, scrubSentryEvent, scrubSentrySpan, scrubText } from '@/lib/observability/scrub-pii';

const TOK = 'f3a9c1d2e4b5a6978877665544332211';

describe('scrubSentrySpan — referer a URL s tokenem', () => {
  it('referer s dotazem: zůstane schéma, hostitel a cesta; dotaz a fragment pryč', () => {
    const span = scrubSentrySpan({
      name: `GET /cs/reset-password?token=${TOK}`,
      attributes: {
        'http.request.header.referer': [`http://localhost:3200/cs/reset-password?token=${TOK}&lang=cs#formular`],
        'http.target': `/cs/events/e1/seats/kategorie?token=${TOK}&seats=s1,s2`,
        'next.span_name': `GET /cs/reset-password?token=${TOK}`,
        'url.full': `http://localhost:3200/api/x?Token=${TOK}&page=2`,
        'url.query': `?code=${TOK}&page=2`,
        'http.route': '/api/x',
      },
    });
    expect(JSON.stringify(span)).not.toContain(TOK);
    expect(span.attributes['http.request.header.referer']).toEqual(['http://localhost:3200/cs/reset-password']);
    expect(span.attributes['http.target']).toBe('/cs/events/e1/seats/kategorie?token=[skryto]&seats=s1,s2');
    expect(span.attributes['next.span_name']).toBe('GET /cs/reset-password?token=[skryto]');
    expect(span.name).toBe('GET /cs/reset-password?token=[skryto]');
    expect(span.attributes['url.full']).toBe('http://localhost:3200/api/x?Token=[skryto]&page=2');
    expect(span.attributes['url.query']).toBe('?code=[skryto]&page=2');
    expect(span.attributes['http.route']).toBe('/api/x');
  });
});

describe('scrubText — parametry dotazu', () => {
  it.each([
    [`/x?token=${TOK}`, '/x?token=[skryto]'],
    [`/x?a=1&SIG=${TOK}&b=2`, '/x?a=1&SIG=[skryto]&b=2'],
    [`/x?access_token=${TOK}&refresh_token=${TOK}`, '/x?access_token=[skryto]&refresh_token=[skryto]'],
    [`/x?sessionId=${TOK}&session_id=${TOK}&otp=123456&hash=${TOK}`, '/x?sessionId=[skryto]&session_id=[skryto]&otp=[skryto]&hash=[skryto]'],
    [`/x?key=${TOK}&secret=${TOK}&signature=${TOK}&password=heslo123`, '/x?key=[skryto]&secret=[skryto]&signature=[skryto]&password=[skryto]'],
    // URL-kódovaný token i vnořená URL-kódovaná URL (např. návratová adresa)
    [`/x?token=${encodeURIComponent(`${TOK}+/=`)}`, '/x?token=[skryto]'],
    [`/login?returnTo=${encodeURIComponent(`/cs/reset-password?token=${TOK}&lang=cs`)}`, '/login?returnTo=%2Fcs%2Freset-password%3Ftoken%3D[skryto]%26lang%3Dcs'],
    // fragment (OAuth implicitní tok)
    [`/cb#access_token=${TOK}&lang=xyz`, '/cb#access_token=[skryto]&lang=xyz'],
    // query_string bez otazníku
    [`token=${TOK}&page=2`, 'token=[skryto]&page=2'],
  ])('%s', (input, out) => { expect(scrubText(input)).toBe(out); });

  it('další názvy ze soupisu (logs/r21/1_url_secrets.md, tabulka A)', () => {
    const names = ['state', 'queueToken', 'seatHoldToken', 'lotteryToken', 'lotteryEntryId', 'groupInvitation', 'waitlistId', 'orderId',
      'next', 'redirect', 'client_secret', 'api_secret', 'apikey', 'app_id'];
    const s = scrubText(`/x?${names.map((n) => `${n}=${TOK}`).join('&')}&page=2`);
    expect(s).toBe(`/x?${names.map((n) => `${n}=[skryto]`).join('&')}&page=2`);
  });

  it('parametr jiného názvu zůstane (i když název obsahuje token/code)', () => {
    const s = `/x?page=2&seats=a1,b2&promoCode=JARO&tokenized=1&lang=cs&eventId=${TOK}`;
    expect(scrubText(s)).toBe(s);
  });
});

describe('scrubSentryEvent — request a breadcrumbs', () => {
  it('Referer bez dotazu, URL a query_string bez tokenů, ostatní beze změny', () => {
    const ev = scrubSentryEvent({
      request: {
        url: `http://localhost:3200/api/ops/sentry-check?token=${TOK}&lang=cs`,
        query_string: `token=${TOK}&lang=cs`,
        headers: { Referer: `http://localhost:3200/cs/reset-password?token=${TOK}#r21`, referer: `http://localhost:3200/cs/x?code=${TOK}`, 'User-Agent': 'Mozilla/5.0' },
      },
      breadcrumbs: [{ category: 'fetch', data: { url: `/api/public/events/e1/seat-prices?token=${TOK}`, method: 'GET' } }],
      tags: { runbook: 'https://example.invalid/runbook' },
    });
    expect(JSON.stringify(ev)).not.toContain(TOK);
    expect(ev.request.headers.Referer).toBe('http://localhost:3200/cs/reset-password');
    expect(ev.request.headers.referer).toBe('http://localhost:3200/cs/x');
    expect(ev.request.headers['User-Agent']).toBe('Mozilla/5.0');
    expect(ev.request.url).toBe('http://localhost:3200/api/ops/sentry-check?token=[skryto]&lang=cs');
    expect(ev.request.query_string).toBe('token=[skryto]&lang=cs');
    expect(ev.breadcrumbs[0].data.url).toBe('/api/public/events/e1/seat-prices?token=[skryto]');
    expect(ev.tags).toEqual({ runbook: 'https://example.invalid/runbook' });
  });

  it('query_string jako dvojice [název, hodnota]', () => {
    const ev = scrubSentryEvent({ request: { query_string: [['token', TOK], ['lang', 'cs']] } });
    expect(ev.request.query_string).toEqual([['token', '[skryto]'], ['lang', 'cs']]);
  });

  it('stávající maskování zůstává (e-mail, telefon, citlivé klíče)', () => {
    const ev = scrubSentryEvent({ message: `kupec jana@x.cz, tel. +420 777 123 456, /x?token=${TOK}`, extra: { buyerName: 'Jana Nováková' } });
    expect(ev.message).toBe('kupec [email], tel. [telefon], /x?token=[skryto]');
    expect(ev.extra.buyerName).toBe('[skryto]');
  });
});

describe('SENTRY_DATA_COLLECTION.urlQueryParams.deny', () => {
  it('obsahuje názvy s tajemstvím v URL i původní výrazy v10', () => {
    const deny = (SENTRY_DATA_COLLECTION.urlQueryParams as { deny: string[] }).deny;
    for (const n of ['token', 'code', 'key', 'secret', 'signature', 'sig', 'hash', 'otp', 'password', 'access_token', 'refresh_token', 'sessionId', 'session_id',
      'forwarded', '-ip', 'remote-', 'via', '-user']) expect(deny).toContain(n);
  });
});
