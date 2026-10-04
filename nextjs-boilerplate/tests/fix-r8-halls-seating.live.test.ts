// @vitest-environment node
/**
 * Kolo 8 / krok 2 — knihovna míst (místo → sál → plánek), plánek z generátoru, termín ze sálu, nákup místa.
 *
 * Zadání testu: generátorem sál o 300 místech ve 3 sekcích, 3 cenové zóny, 2 místa pro vozíčkáře s doprovodem,
 * uložení, termín z tohoto sálu, nákup konkrétního místa. Navíc: duplicitní označení místa nejde uložit,
 * pozdější úprava plánku sálu nezmění prodaný termín, neprodaný termín jde převzít znovu.
 */
import { randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSection, seatKey, setSeatType, setSeatZone, type GenSector } from '@/lib/seating/generator';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx?: unknown) => Promise<Response>;

function hall300(): { sectors: GenSector[]; zones: Array<{ id: string; name: string; color: string }> } {
  let sectors: GenSector[] = [
    generateSection({ name: 'Přízemí', color: '#7c3aed', rows: 10, seatsPerRow: 18, aisleAfter: [9], origin: { x: 60, y: 120 } }),
    generateSection({ name: 'Balkon', color: '#0ea5e9', rows: 5, seatsPerRow: 20, rowLabels: 'letter', origin: { x: 40, y: 520 } }),
    generateSection({ name: 'Lóže', color: '#f59e0b', rows: 2, seatsPerRow: 10, seatNumbering: 'odd-even', origin: { x: 200, y: 720 } }),
  ];
  const zones = [
    { id: 'A', name: 'Zóna A', color: '#dc2626' },
    { id: 'B', name: 'Zóna B', color: '#2563eb' },
    { id: 'C', name: 'Zóna C', color: '#16a34a' },
  ];
  const keys = (pred: (sec: string, row: string) => boolean) => new Set(sectors.flatMap((s) => s.rows.filter((r) => pred(s.name, r.label))
    .flatMap((r) => r.seats.map((x) => seatKey(s.name, r.label, x.num)))));
  sectors = setSeatZone(sectors, keys((s, r) => s === 'Přízemí' && Number(r) <= 5), 'A');
  sectors = setSeatZone(sectors, keys((s, r) => s === 'Přízemí' && Number(r) > 5), 'B');
  sectors = setSeatZone(sectors, keys((s) => s !== 'Přízemí'), 'C');
  // řada 10 přízemí: místa 1 a 18 pro vozíčkáře, 2 a 17 doprovod
  sectors = setSeatType(sectors, new Set([seatKey('Přízemí', '10', '1'), seatKey('Přízemí', '10', '18')]), 'wheelchair');
  sectors = setSeatType(sectors, new Set([seatKey('Přízemí', '10', '2'), seatKey('Přízemí', '10', '17')]), 'companion');
  return { sectors, zones };
}

run('Kolo 8 — sály, plánek a termín ze sálu', () => {
  let clone: LocalClone;
  let c: Awaited<ReturnType<LocalClone['seed']['chain']>>;
  let tok: string;
  let hallId = '';
  let productionId = '';
  let termId = '';

  const call = async (method: string, url: string, mod: () => Promise<Record<string, unknown>>, body?: unknown, headers: Record<string, string> = {}, ctx: unknown = {}) => {
    const m = await mod();
    const r = await throughMiddleware(new Request(`http://localhost${url}`, {
      method,
      headers: { 'content-type': 'application/json', origin: 'http://localhost', authorization: `Bearer ${tok}`, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), m[method] as H, ctx);
    const text = await r.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text); } catch { /* */ }
    return { status: r.status, json, text };
  };
  const chartRoute = () => import('@/app/api/admin/venues/[venueId]/seating-chart/route');

  beforeAll(async () => {
    clone = await createLocalClone();
    c = await clone.seed.chain();
    const { signAccessToken } = await import('@/lib/auth');
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [c.adminUserId])).rows[0].email;
    tok = await signAccessToken({ id: c.adminUserId, email, name: 'U' } as never, {
      isPlatformAdmin: false, promoterMemberships: [{ promoterId: c.promoterId, slug: 'x', name: 'x', status: 'active', role: 'owner' }],
    } as never);
  }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 60_000);

  it('místo → sál v knihovně pořadatele', async () => {
    const city = `Olomouc-${randomUUID().slice(0, 6)}`;
    const p = await call('POST', '/api/admin/venue-places', () => import('@/app/api/admin/venue-places/route'),
      { name: 'Moravské divadlo', city, address: 'Horní náměstí 22' });
    expect(p.status, p.text).toBe(201);
    const placeId = (p.json.place as { id: string }).id;
    const h = await call('POST', `/api/admin/venue-places/${placeId}/halls`, () => import('@/app/api/admin/venue-places/[id]/halls/route'),
      { name: 'Velký sál' }, {}, { params: { id: placeId } });
    expect(h.status, h.text).toBe(201);
    hallId = (h.json.hall as { id: string }).id;
    expect(h.json.hall).toMatchObject({ name: 'Moravské divadlo – Velký sál', city });
    const g = await call('GET', '/api/admin/venue-places', () => import('@/app/api/admin/venue-places/route'));
    const place = (g.json.places as Array<{ id: string; halls: Array<{ id: string; hasChart: boolean }> }>).find((x) => x.id === placeId);
    expect(place?.halls).toEqual([expect.objectContaining({ id: hallId, hasChart: false })]);
  });

  it('plánek z generátoru (300 míst, 3 sekce, 3 zóny, vozíčkáři s doprovodem) se uloží; duplicitní místo ne', async () => {
    const { sectors, zones } = hall300();
    const ok = await call('POST', `/api/admin/venues/${hallId}/seating-chart`, chartRoute,
      { name: 'Velký sál 2027', layout: { viewBox: '0 0 900 900', sectors, zones, stage: { position: 'top', label: 'JEVIŠTĚ' } } }, {}, { params: { venueId: hallId } });
    expect(ok.status, ok.text).toBe(201);
    expect(ok.json.totalSeats).toBe(300);
    const dup = structuredClone(sectors);
    dup[0].rows[0].seats[1].num = '1';
    const bad = await call('POST', `/api/admin/venues/${hallId}/seating-chart`, chartRoute,
      { name: 'Chybný', layout: { viewBox: '0 0 900 900', sectors: dup, zones } }, {}, { params: { venueId: hallId } });
    expect(bad.status).toBe(422);
    expect(bad.json.message).toContain('Přízemí / řada 1 / místo 1');
    // aktivní zůstává platný plánek
    expect((await clone.pool.query(`SELECT name FROM catalog.venue_seating_charts WHERE venue_id=$1 AND active`, [hallId])).rows).toEqual([{ name: 'Velký sál 2027' }]);
  });

  it('termín ze sálu: ceny podle zón, sedadla s typy a zónami', async () => {
    const pr = await call('POST', '/api/admin/productions', () => import('@/app/api/admin/productions/route'), { title: 'Lucerna', durationMin: 120 });
    productionId = (pr.json.production as { id: string }).id;
    const t = await call('POST', `/api/admin/productions/${productionId}/terms`, () => import('@/app/api/admin/productions/[id]/terms/route'), {
      venueId: hallId, dateStart: '2027-06-01T19:00:00+02:00',
      zonePrices: [
        { zone: 'Zóna A', priceHalire: 59000, vatRateCode: 'CZ_REDUCED' },
        { zone: 'Zóna B', priceHalire: 45000, vatRateCode: 'CZ_REDUCED' },
        { zone: 'Zóna C', priceHalire: 29000, vatRateCode: 'CZ_REDUCED' },
      ],
    }, {}, { params: { id: productionId } });
    expect(t.status, t.text).toBe(201);
    expect(t.json).toMatchObject({ seats: 300, ticketTypes: 3 });
    termId = t.json.eventId as string;
    await clone.pool.query(`UPDATE catalog.events SET status='published' WHERE id=$1`, [termId]);

    const byZone = (await clone.pool.query(
      `SELECT s.price_zone, tt.name, tt.base_price, count(*)::int n, tt.total_qty
         FROM catalog.event_seats s JOIN catalog.ticket_types tt ON tt.id = s.ticket_type_id
        WHERE s.event_id=$1 GROUP BY 1,2,3,5 ORDER BY 1`, [termId])).rows;
    expect(byZone).toEqual([
      { price_zone: 'Zóna A', name: 'Zóna A', base_price: 59000, n: 90, total_qty: 90 },
      { price_zone: 'Zóna B', name: 'Zóna B', base_price: 45000, n: 90, total_qty: 90 },
      { price_zone: 'Zóna C', name: 'Zóna C', base_price: 29000, n: 120, total_qty: 120 },
    ]);
    const types = (await clone.pool.query(
      `SELECT seat_type, accessibility, count(*)::int n FROM catalog.event_seats WHERE event_id=$1 GROUP BY 1,2 ORDER BY 1`, [termId])).rows;
    expect(types).toEqual([
      { seat_type: 'companion', accessibility: false, n: 2 },
      { seat_type: 'standard', accessibility: false, n: 296 },
      { seat_type: 'wheelchair', accessibility: true, n: 2 },
    ]);
  });

  it('úprava plánku sálu: neprodaný termín jde převzít znovu; nákup konkrétního místa; prodaný termín se už nemění', async () => {
    // nová verze plánku sálu: bez Lóže (280 míst)
    const { sectors, zones } = hall300();
    const v2 = await call('POST', `/api/admin/venues/${hallId}/seating-chart`, chartRoute,
      { name: 'Velký sál bez lóží', layout: { viewBox: '0 0 900 900', sectors: sectors.slice(0, 2), zones } }, {}, { params: { venueId: hallId } });
    expect(v2.status, v2.text).toBe(201);
    expect((await clone.pool.query(`SELECT count(*)::int n FROM catalog.event_seats WHERE event_id=$1`, [termId])).rows[0].n).toBe(300);
    const refresh = () => call('POST', `/api/admin/events/${termId}/seats/refresh`, () => import('@/app/api/admin/events/[id]/seats/refresh/route'), {}, {}, { params: { id: termId } });
    const r1 = await refresh();
    expect(r1.status, r1.text).toBe(200);
    expect(r1.json.seats).toBe(280);
    expect((await clone.pool.query(`SELECT total_qty FROM catalog.ticket_types WHERE event_id=$1 AND zone='Zóna C'`, [termId])).rows[0].total_qty).toBe(100);

    // nákup konkrétního místa: Přízemí, řada 3, místo 7
    const seat = (await clone.pool.query(
      `SELECT id, ticket_type_id FROM catalog.event_seats WHERE event_id=$1 AND sector='Přízemí' AND row='3' AND seat_number='7'`, [termId])).rows[0];
    const ip = { 'x-forwarded-for': `198.51.130.${Math.floor(Math.random() * 250) + 1}` };
    const { POST: hold } = await import('@/app/api/events/[id]/seats/hold/route');
    const hr = await (hold as unknown as H)(new Request(`http://localhost/api/events/${termId}/seats/hold`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...ip }, body: JSON.stringify({ seatIds: [seat.id] }),
    }) as unknown as NextRequest, { params: { id: termId } });
    const hj = await hr.json();
    expect(hr.status, JSON.stringify(hj)).toBe(200);
    const { POST: checkout } = await import('@/app/api/checkout/route');
    const co = await (checkout as unknown as H)(new Request('http://localhost/api/checkout', {
      method: 'POST', headers: { 'content-type': 'application/json', ...ip },
      body: JSON.stringify({ eventId: termId, ticketTypeId: seat.ticket_type_id, quantity: 1, seatIds: [seat.id], seatHoldToken: hj.holdToken,
        buyerEmail: `seat-${randomUUID().slice(0, 6)}@tixly.test`, buyerName: 'Kupec Místa' }),
    }) as unknown as NextRequest);
    const cj = await co.json();
    expect(co.status, JSON.stringify(cj)).toBe(200);
    const sold = (await clone.pool.query(`SELECT status, order_id FROM catalog.event_seats WHERE id=$1`, [seat.id])).rows[0];
    expect(sold).toEqual({ status: 'sold', order_id: cj.orderId });
    const order = (await clone.pool.query(`SELECT total_amount FROM orders.orders WHERE id=$1`, [cj.orderId])).rows[0];
    expect(order.total_amount).toBe(59000);

    // termín s prodejem se znovu převzít nedá a plánek sálu ho nezmění
    const r2 = await refresh();
    expect(r2.status).toBe(409);
    expect(r2.json.error).toBe('HAS_SALES');
    expect((await clone.pool.query(`SELECT count(*)::int n FROM catalog.event_seats WHERE event_id=$1`, [termId])).rows[0].n).toBe(280);
  });
});
