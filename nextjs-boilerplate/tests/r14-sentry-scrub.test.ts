/**
 * Kolo 14 / krok 3 — Sentry nesmí dostat osobní údaje kupců: e-maily, jména, telefony se maskují v textu chyby,
 * ve stack frame proměnných, v datech požadavku, kontextech, extra i breadcrumbs; z user zůstane jen id.
 */
import { describe, expect, it } from 'vitest';
import { scrubSentryEvent, scrubText } from '@/lib/observability/scrub-pii';

describe('scrubText', () => {
  it.each([
    ['Objednávka pro jana.novakova@example.cz selhala', 'Objednávka pro [email] selhala'],
    ['volat +420 777 123 456 nebo 777123456', 'volat [telefon] nebo [telefon]'],
    ['tel. 00420 602 111 222', 'tel. [telefon]'],
  ])('%s', (input, out) => { expect(scrubText(input)).toBe(out); });
  it('nechá UUID, částky a čísla objednávek', () => {
    const s = 'order 2f9084f6-8171-40c2-aecf-17f190d8a4f5 za 1 400 Kč, faktura 2026-0001, kód 482913';
    expect(scrubText(s)).toBe(s);
  });
});

describe('scrubSentryEvent', () => {
  it('maskuje osobní údaje všude a z user nechá jen id', () => {
    const ev = scrubSentryEvent({
      message: 'Selhal e-mail pro petr@firma.cz',
      user: { id: 'u-1', email: 'petr@firma.cz', username: 'Petr Novák', ip_address: '10.0.0.1' },
      exception: { values: [{ type: 'Error', value: 'buyer jana@x.cz, tel +420 777 123 456', stacktrace: { frames: [{ vars: { buyerName: 'Jana Nováková', buyerEmail: 'jana@x.cz', orderId: 'o-1' } }] } }] },
      request: { url: 'https://app.tixly.cz/api/checkout/seats?email=jana%40x.cz', data: { buyerName: 'Jana Nováková', buyerEmail: 'jana@x.cz', buyerPhone: '+420777123456', items: [{ seatId: 's-1' }] }, query_string: 'email=jana@x.cz' },
      contexts: { order: { holder_name: 'Jana Nováková', total: 45000 } },
      extra: { note: 'kupec Jana, jana@x.cz' },
      breadcrumbs: [{ message: 'POST /api/checkout/seats jana@x.cz', data: { phone: '777123456' } }],
      tags: { runbook: 'x' },
    });
    const json = JSON.stringify(ev);
    expect(json).not.toMatch(/jana@x\.cz|petr@firma\.cz|Nováková|Petr Novák|777 ?123 ?456|777123456|10\.0\.0\.1/);
    expect(ev.user).toEqual({ id: 'u-1' });
    expect((ev.request as { data: { items: unknown } }).data.items).toEqual([{ seatId: 's-1' }]); // ne-osobní data zůstanou
    expect((ev.contexts as { order: { total: number } }).order.total).toBe(45000);
    expect(ev.tags).toEqual({ runbook: 'x' });
  });
});
