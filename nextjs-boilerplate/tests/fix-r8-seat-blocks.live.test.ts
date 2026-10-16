// @vitest-environment node
/**
 * Kolo 8 / krok 3 — pojmenované blokace míst.
 *
 * Očekávané:
 *   - pořadatel vytvoří blokaci (Firma XY, Tisk, Technika…) nad vybranými místy nebo celou sekcí, s poznámkou;
 *   - blokovaná místa nejdou koupit online ani držet (rezervovat); pokladna je vidí blokovaná s názvem blokace;
 *   - z blokace: uvolnit vybraná / všechna místa do prodeje, volné vstupenky na jména, prodej na pokladně;
 *   - přehled: blokace | míst celkem | uvolněno | vydáno | prodáno (+ zbývá blokováno);
 *   - kapacita (remaining_qty) se blokací sníží a uvolněním vrátí;
 *   - souběh: uvolnění místa a současný nákup → místo prodáno jen jednou.
 */
import { randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx?: unknown) => Promise<Response>;

run('Kolo 8 — blokace míst', () => {
  let clone: LocalClone;
  let c: Awaited<ReturnType<LocalClone['seed']['chain']>>;
  let tok: string;
  let seats: Array<{ id: string; sector: string; row: string; seat_number: string }>;

  const call = async (method: string, url: string, mod: () => Promise<Record<string, unknown>>, body?: unknown, ctx: unknown = {}, headers: Record<string, string> = {}) => {
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
  const blocksRoute = () => import('@/app/api/admin/events/[id]/blocks/route');
  const releaseRoute = () => import('@/app/api/admin/events/[id]/blocks/[blockId]/release/route');
  const compsRoute = () => import('@/app/api/admin/events/[id]/blocks/[blockId]/comps/route');
  const remaining = async () => (await clone.pool.query(`SELECT remaining_qty FROM catalog.ticket_types WHERE id=$1`, [c.ticketTypeId])).rows[0].remaining_qty as number;
  const seatState = async (id: string) => (await clone.pool.query(`SELECT status, hold_kind, hold_label FROM catalog.event_seats WHERE id=$1`, [id])).rows[0];
  const holdSeat = async (seatId: string) => {
    const { POST } = await import('@/app/api/events/[id]/seats/hold/route');
    const r = await (POST as unknown as H)(new Request(`http://localhost/api/events/${c.eventId}/seats/hold`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.140.${Math.floor(Math.random() * 250) + 1}` },
      body: JSON.stringify({ seatIds: [seatId] }),
    }) as unknown as NextRequest, { params: { id: c.eventId } });
    return { status: r.status, json: await r.json() as { holdToken?: string } };
  };

  beforeAll(async () => {
    clone = await createLocalClone();
    c = await clone.seed.chain({ totalQty: 30, remainingQty: 30, basePrice: 40000 });
    await clone.pool.query(`UPDATE catalog.ticket_types SET is_seated = true, zone = 'Přízemí' WHERE id=$1`, [c.ticketTypeId]);
    // 3 sekce × 10 míst
    for (const sector of ['Přízemí', 'Balkon', 'Lóže']) {
      for (let n = 1; n <= 10; n++) {
        await clone.pool.query(
          `INSERT INTO catalog.event_seats (event_id, ticket_type_id, sector, row, seat_number, x_coord, y_coord, status)
           VALUES ($1,$2,$3,'1',$4,$5,10,'available')`, [c.eventId, c.ticketTypeId, sector, String(n), n * 20]);
      }
    }
    seats = (await clone.pool.query(`SELECT id, sector, row, seat_number FROM catalog.event_seats WHERE event_id=$1 ORDER BY sector, seat_number::int`, [c.eventId])).rows;
    const { signAccessToken } = await import('@/lib/auth');
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [c.adminUserId])).rows[0].email;
    tok = await signAccessToken({ id: c.adminUserId, email, name: 'U' } as never, {
      isPlatformAdmin: false, promoterMemberships: [{ promoterId: c.promoterId, slug: 'x', name: 'x', status: 'active', role: 'owner' }],
    } as never);
  }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 60_000);

  const pr = (n: string) => seats.find((s) => s.sector === 'Přízemí' && s.seat_number === n)!.id;
  let firma = '';
  let tisk = '';

  it('blokace vybraných míst a celé sekce; obsazené místo se nezablokuje; kapacita se sníží', async () => {
    const a = await call('POST', `/api/admin/events/${c.eventId}/blocks`, blocksRoute,
      { name: 'Firma XY', note: 'objednávka do pátku', color: '#7c3aed', seatIds: ['1', '2', '3', '4', '5', '6'].map(pr) }, { params: { id: c.eventId } });
    expect(a.status, a.text).toBe(201);
    expect(a.json).toMatchObject({ blocked: 6, skipped: [] });
    firma = (a.json.block as { id: string }).id;
    // místo prodané jinde se do blokace nedostane
    await clone.pool.query(`UPDATE catalog.event_seats SET status='sold' WHERE event_id=$1 AND sector='Lóže' AND seat_number='10'`, [c.eventId]);
    const b = await call('POST', `/api/admin/events/${c.eventId}/blocks`, blocksRoute,
      { name: 'Technika', sector: 'Lóže' }, { params: { id: c.eventId } });
    expect(b.status, b.text).toBe(201);
    expect(b.json.blocked).toBe(9);
    expect((b.json.skipped as unknown[]).length).toBe(1);
    const t = await call('POST', `/api/admin/events/${c.eventId}/blocks`, blocksRoute,
      { name: 'Tisk', seatIds: ['7', '8', '9', '10'].map(pr) }, { params: { id: c.eventId } });
    tisk = (t.json.block as { id: string }).id;
    expect(await seatState(pr('1'))).toEqual({ status: 'blocked', hold_kind: 'block', hold_label: 'Firma XY' });
    expect(await remaining()).toBe(30 - 6 - 9 - 4);
    // stejný název blokace v termínu podruhé ne
    expect((await call('POST', `/api/admin/events/${c.eventId}/blocks`, blocksRoute, { name: 'Tisk', seatIds: [seats[12].id] }, { params: { id: c.eventId } })).status).toBe(409);
  });

  it('blokované místo nejde koupit online ani podržet', async () => {
    const h = await holdSeat(pr('1'));
    expect(h.status).toBe(409);
  });

  it('pokladna vidí místo blokované s názvem blokace a může z blokace prodat; mimo blokaci ne', async () => {
    const g = await call('GET', `/api/admin/pos/events/${c.eventId}/seats`, () => import('@/app/api/admin/pos/events/[eventId]/seats/route'), undefined, { params: { eventId: c.eventId } });
    expect(g.status, g.text).toBe(200);
    const s1 = (g.json.seats as Array<{ id: string; status: string; blockName: string | null }>).find((x) => x.id === pr('1'));
    expect(s1).toMatchObject({ status: 'blocked', blockName: 'Firma XY' });

    const sale = (seatIds: string[], blockId?: string) => call('POST', '/api/admin/pos/sale', () => import('@/app/api/admin/pos/sale/route'),
      { eventId: c.eventId, ticketTypeId: c.ticketTypeId, quantity: seatIds.length, seatIds, paymentMethod: 'cash', blockId }, {});
    expect((await sale([pr('6')])).status).toBe(422); // blokované bez blokace v požadavku ne
    const ok = await sale([pr('6')], firma);
    expect(ok.status, ok.text).toBe(200);
    expect((await seatState(pr('6'))).status).toBe('sold');
    expect(await remaining()).toBe(11); // prodej z blokace kapacitu znovu neodečte
    expect((await sale([pr('7')], firma)).status).toBe(422); // místo z jiné blokace
  });

  it('volné vstupenky z blokace na jména', async () => {
    const r = await call('POST', `/api/admin/events/${c.eventId}/blocks/${tisk}/comps`, compsRoute, {
      seats: [
        { seatId: pr('7'), holderName: 'Jana Redaktorová' },
        { seatId: pr('8'), holderName: 'Petr Fotograf' },
      ],
      recipientEmail: `tisk-${randomUUID().slice(0, 6)}@redakce.test`,
    }, { params: { id: c.eventId, blockId: tisk } });
    expect(r.status, r.text).toBe(201);
    const tickets = (await clone.pool.query(
      `SELECT t.holder_name, es.seat_number, o.total_amount, o.payment_provider FROM tickets.tickets t
         JOIN orders.orders o ON o.id = t.order_id JOIN catalog.event_seats es ON es.id = t.event_seat_id
        WHERE o.id = $1 ORDER BY es.seat_number::int`, [r.json.orderId])).rows;
    expect(tickets).toEqual([
      { holder_name: 'Jana Redaktorová', seat_number: '7', total_amount: 0, payment_provider: 'comp' },
      { holder_name: 'Petr Fotograf', seat_number: '8', total_amount: 0, payment_provider: 'comp' },
    ]);
    expect(await remaining()).toBe(11);
  });

  it('uvolnění vybraných míst do prodeje; pak jdou koupit; přehled blokací sedí', async () => {
    const r = await call('POST', `/api/admin/events/${c.eventId}/blocks/${firma}/release`, releaseRoute, { seatIds: [pr('5')] }, { params: { id: c.eventId, blockId: firma } });
    expect(r.status, r.text).toBe(200);
    expect(r.json.released).toBe(1);
    expect(await seatState(pr('5'))).toEqual({ status: 'available', hold_kind: null, hold_label: null });
    expect(await remaining()).toBe(12);
    expect((await holdSeat(pr('5'))).status).toBe(200);

    const g = await call('GET', `/api/admin/events/${c.eventId}/blocks`, blocksRoute, undefined, { params: { id: c.eventId } });
    const ov = Object.fromEntries((g.json.blocks as Array<{ name: string; total: number; released: number; issued: number; sold: number; blocked: number }>)
      .map((b) => [b.name, { total: b.total, released: b.released, issued: b.issued, sold: b.sold, blocked: b.blocked }]));
    expect(ov).toEqual({
      'Firma XY': { total: 6, released: 1, issued: 0, sold: 1, blocked: 4 },
      Tisk: { total: 4, released: 0, issued: 2, sold: 0, blocked: 2 },
      Technika: { total: 9, released: 0, issued: 0, sold: 0, blocked: 9 },
    });
    // mapa: blokovaná místa s barvou blokace
    const s2 = (g.json.seats as Array<{ id: string; blockId: string | null; color: string | null }>).find((x) => x.id === pr('2'));
    expect(s2).toMatchObject({ blockId: firma, color: '#7c3aed' });

    const all = await call('POST', `/api/admin/events/${c.eventId}/blocks/${firma}/release`, releaseRoute, {}, { params: { id: c.eventId, blockId: firma } });
    expect(all.json.released).toBe(4);
  });

  it('souběh: uvolnění místa a současné nákupy → místo prodáno jen jednou', async () => {
    const seat = seats.find((s) => s.sector === 'Lóže' && s.seat_number === '1')!.id;
    const technika = ((await call('GET', `/api/admin/events/${c.eventId}/blocks`, blocksRoute, undefined, { params: { id: c.eventId } })).json.blocks as Array<{ id: string; name: string }>)
      .find((b) => b.name === 'Technika')!.id;
    const results = await Promise.all([
      call('POST', `/api/admin/events/${c.eventId}/blocks/${technika}/release`, releaseRoute, { seatIds: [seat] }, { params: { id: c.eventId, blockId: technika } }),
      holdSeat(seat), holdSeat(seat), holdSeat(seat),
    ]);
    expect(results[0].status).toBe(200);
    const holds = results.slice(1).filter((r) => r.status === 200);
    expect(holds.length).toBeLessThanOrEqual(1);
    // kdo místo nedržel, dostane ho nejvýš jeden další pokus
    const later = holds.length === 0 ? [await holdSeat(seat), await holdSeat(seat)].filter((r) => r.status === 200) : [];
    expect(holds.length + later.length).toBe(1);
    const row = (await clone.pool.query(`SELECT status FROM catalog.event_seats WHERE id=$1`, [seat])).rows[0];
    expect(row.status).toBe('held');
  });
});
