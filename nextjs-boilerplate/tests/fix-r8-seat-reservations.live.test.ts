// @vitest-environment node
/**
 * Kolo 8 / krok 5 — rezervace s platbou na pokladně.
 *
 * Očekávané:
 *   - termín: povolit rezervace + lhůta N dní od vytvoření (výchozí 5), nejpozději M hodin před začátkem (výchozí 2) —
 *     vynucuje server (vytvoření i platba na pokladně);
 *   - kupec vybere místa + kategorie a „Rezervovat, zaplatím na pokladně" → e-mail s kódem, místy, cenou, lhůtou a odkazem na zrušení;
 *   - pokladna najde rezervaci podle kódu / jména / e-mailu / telefonu, přijme platbu hotově / kartou (způsob se zapíše),
 *     vystaví vstupenky a doklad;
 *   - cron (cron-auth přes dispatcher): propadlé rezervace uvolní místa + e-mail; 24 h předem připomínka (jednou);
 *   - zrušení odkazem z e-mailu; limity 2 aktivní rezervace a 10 míst na e-mail a termín (i souběžně);
 *   - rezervace se počítají do obsazenosti, ale vykazují se zvlášť od prodaných;
 *   - POS prodej zapíše způsob platby (dřív se zahodil).
 */
import { randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx?: unknown) => Promise<Response>;

run('Kolo 8 — rezervace s platbou na pokladně', () => {
  let clone: LocalClone;
  let c: Awaited<ReturnType<LocalClone['seed']['chain']>>;
  let tok: string;
  const seat: string[] = [];
  const cat: Record<string, string> = {};
  const realFetch = globalThis.fetch;

  const admin = async (method: string, url: string, mod: () => Promise<Record<string, unknown>>, body?: unknown, ctx: unknown = {}) => {
    const m = await mod();
    const r = await throughMiddleware(new Request(`http://localhost${url}`, {
      method, headers: { 'content-type': 'application/json', origin: 'http://localhost', authorization: `Bearer ${tok}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), m[method] as H, ctx);
    const text = await r.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text); } catch { /* */ }
    return { status: r.status, json, text };
  };
  const ip = () => `198.51.160.${Math.floor(Math.random() * 250) + 1}`;
  async function hold(ids: number[]) {
    const { POST } = await import('@/app/api/events/[id]/seats/hold/route');
    const r = await (POST as unknown as H)(new Request(`http://localhost/api/events/${c.eventId}/seats/hold`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip() }, body: JSON.stringify({ seatIds: ids.map((i) => seat[i]) }),
    }) as unknown as NextRequest, { params: { id: c.eventId } });
    const j = await r.json() as { holdToken: string };
    expect(r.status, JSON.stringify(j)).toBe(200);
    return j.holdToken;
  }
  async function reserve(ids: number[], email: string, extra: Record<string, unknown> = {}) {
    const token = await hold(ids);
    const { POST } = await import('@/app/api/checkout/seats/route');
    const r = await (POST as unknown as H)(new Request('http://localhost/api/checkout/seats', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip() },
      body: JSON.stringify({
        eventId: c.eventId, seatHoldToken: token, items: ids.map((i) => ({ seatId: seat[i], categoryId: cat.plne })),
        buyerEmail: email, buyerName: 'Jana Rezervující', buyerPhone: '+420 777 123 456', paymentMethod: 'box_office_reservation', ...extra,
      }),
    }) as unknown as NextRequest);
    const text = await r.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text); } catch { /* */ }
    return { status: r.status, json, text };
  }
  const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:58225';
  /** Nejnovější e-mail pro adresu, jehož předmět obsahuje subjectPart (mailpitLatest bere jen poslední zprávu). */
  const mailFor = async (to: string, subjectPart: string) => {
    for (let i = 0; i < 40; i++) {
      const j = await (await realFetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent('to:' + to)}&limit=20`)).json() as { messages?: Array<{ ID: string; Subject: string }> };
      const hit = j.messages?.find((m) => m.Subject.includes(subjectPart));
      if (hit) {
        const mj = await (await realFetch(`${MAILPIT}/api/v1/message/${hit.ID}`)).json() as { HTML?: string; Text?: string };
        return { id: hit.ID, subject: hit.Subject, html: mj.HTML ?? mj.Text ?? '' };
      }
      await new Promise((res) => setTimeout(res, 250));
    }
    throw new Error(`mail „${subjectPart}" pro ${to} nedorazil`);
  };
  const seatStatus = async (i: number) => (await clone.pool.query(`SELECT status, order_id FROM catalog.event_seats WHERE id=$1`, [seat[i]])).rows[0];
  async function cron() {
    const { GET: dispatch } = await import('@/app/api/cron/dispatch/route');
    const { POST: job } = await import('@/app/api/internal/cron/seat-reservations/route');
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (u.pathname === '/api/internal/cron/seat-reservations') return throughMiddleware(new Request(`http://localhost${u.pathname}`, init), job as H);
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      const r = await throughMiddleware(new Request('http://localhost/api/cron/dispatch?job=seat-reservations', {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      }), dispatch as H);
      const body = (await r.json()) as { status: number; result: { expired: number; reminded: number } };
      expect(body.status, JSON.stringify(body)).toBe(200);
      return body.result;
    } finally { globalThis.fetch = realFetch; }
  }

  beforeAll(async () => {
    clone = await createLocalClone();
    c = await clone.seed.chain({ totalQty: 40, remainingQty: 40, basePrice: 40000 });
    await clone.pool.query(`UPDATE catalog.ticket_types SET is_seated = true, zone = 'Přízemí' WHERE id=$1`, [c.ticketTypeId]);
    for (let n = 1; n <= 40; n++) {
      seat.push((await clone.pool.query<{ id: string }>(
        `INSERT INTO catalog.event_seats (event_id, ticket_type_id, sector, row, seat_number, x_coord, y_coord, status)
         VALUES ($1,$2,'Přízemí',$3,$4,$5,10,'available') RETURNING id`,
        [c.eventId, c.ticketTypeId, String(Math.ceil(n / 10)), String(((n - 1) % 10) + 1), n * 20])).rows[0].id);
    }
    const { signAccessToken } = await import('@/lib/auth');
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [c.adminUserId])).rows[0].email;
    tok = await signAccessToken({ id: c.adminUserId, email, name: 'U' } as never, {
      isPlatformAdmin: false, promoterMemberships: [{ promoterId: c.promoterId, slug: 'x', name: 'x', status: 'active', role: 'owner' }],
    } as never);
    const t = await admin('POST', `/api/admin/events/${c.eventId}/categories`, () => import('@/app/api/admin/events/[id]/categories/route'),
      { applyTemplate: true }, { params: { id: c.eventId } });
    for (const x of t.json.categories as Array<{ id: string; code: string }>) cat[x.code] = x.id;
  }, 120_000);
  afterAll(async () => { globalThis.fetch = realFetch; await clone?.cleanup(); }, 60_000);

  it('bez povolení nelze rezervovat; povolení + lhůta 5 dní / 2 h před začátkem; e-mail s kódem, místy, cenou a odkazem', async () => {
    const off = await reserve([0], 'off@tixly.test');
    expect(off.status).toBe(422);
    expect(off.json.error).toBe('RESERVATIONS_DISABLED');
    await clone.pool.query(`UPDATE catalog.event_seats SET status='available', notes=NULL, hold_until=NULL WHERE id=$1`, [seat[0]]);

    const s = await admin('PATCH', `/api/admin/events/${c.eventId}/reservations`, () => import('@/app/api/admin/events/[id]/reservations/route'),
      { enabled: true }, { params: { id: c.eventId } });
    expect(s.status, s.text).toBe(200);
    const d = (await clone.pool.query(`SELECT reservation_days, reservation_cutoff_hours FROM catalog.events WHERE id=$1`, [c.eventId])).rows[0];
    expect(d).toEqual({ reservation_days: 5, reservation_cutoff_hours: 2 });

    const email = `rez-${randomUUID().slice(0, 6)}@tixly.test`;
    const r = await reserve([0, 1], email, { items: [{ seatId: seat[0], categoryId: cat.plne }, { seatId: seat[1], categoryId: cat.senior }] });
    expect(r.status, r.text).toBe(200);
    expect(r.json.totalAmount).toBe(40000 + 32000);
    const until = new Date(r.json.expiresAt as string).getTime();
    expect(Math.abs(until - (Date.now() + 5 * 86_400_000))).toBeLessThan(60_000);
    const row = (await clone.pool.query(
      `SELECT r.status, r.seat_count, o.status AS order_status, o.payment_provider, o.gopay_payment_id
         FROM orders.seat_reservations r JOIN orders.orders o ON o.id = r.order_id WHERE r.code=$1`, [r.json.reservationCode])).rows[0];
    expect(row).toEqual({ status: 'active', seat_count: 2, order_status: 'pending', payment_provider: 'box_office', gopay_payment_id: null });
    expect((await seatStatus(0)).status).toBe('sold');
    const m = await mailFor(email, String(r.json.reservationCode));
    expect(m.html).toContain(String(r.json.reservationCode));
    expect(m.html).toContain('Přízemí, řada 1, místo 2 — Senior — 320 CZK');
    expect(m.html).toContain('720 CZK');
    expect(m.html).toMatch(/rezervace\/zrusit\?code=[A-Z0-9]+&amp;token=|rezervace\/zrusit\?code=[A-Z0-9]+&token=/);

    // lhůta je nejpozději 2 h před začátkem; méně než 2 h před začátkem už rezervovat nejde
    await clone.pool.query(`UPDATE catalog.events SET date_start = now() + interval '30 hours' WHERE id=$1`, [c.eventId]);
    const near = await reserve([2], `near-${randomUUID().slice(0, 6)}@tixly.test`);
    expect(near.status, near.text).toBe(200);
    expect(Math.abs(new Date(near.json.expiresAt as string).getTime() - (Date.now() + 28 * 3_600_000))).toBeLessThan(60_000);
    await clone.pool.query(`UPDATE catalog.events SET date_start = now() + interval '90 minutes' WHERE id=$1`, [c.eventId]);
    const late = await reserve([3], `late-${randomUUID().slice(0, 6)}@tixly.test`);
    expect(late.status).toBe(422);
    expect(late.json.error).toBe('RESERVATION_CLOSED');
    await clone.pool.query(`UPDATE catalog.events SET date_start = now() + interval '30 days' WHERE id=$1`, [c.eventId]);
    await clone.pool.query(`UPDATE catalog.event_seats SET status='available', notes=NULL, hold_until=NULL WHERE id=$1`, [seat[3]]);
  });

  it('pokladna: hledání podle kódu / jména / e-mailu / telefonu, platba kartou → vstupenky, doklad, způsob platby; podruhé nejde', async () => {
    const email = `pok-${randomUUID().slice(0, 6)}@tixly.test`;
    const r = await reserve([4, 5], email, { buyerName: 'Karel Pokladní', buyerPhone: '+420 608 555 111' });
    expect(r.status, r.text).toBe(200);
    const code = String(r.json.reservationCode);
    const search = (q: string) => admin('GET', `/api/admin/seat-reservations?eventId=${c.eventId}&q=${encodeURIComponent(q)}`, () => import('@/app/api/admin/seat-reservations/route'));
    for (const q of [code, code.toLowerCase(), 'Karel Pokl', email, '608555111']) {
      const f = await search(q);
      expect(f.status, f.text).toBe(200);
      expect((f.json.reservations as Array<{ code: string }>).map((x) => x.code), q).toContain(code);
    }
    const found = ((await search(code)).json.reservations as Array<{ id: string; seats: unknown[] }>)[0];
    expect(found.seats).toHaveLength(2);

    const pay = () => admin('POST', `/api/admin/seat-reservations/${found.id}/pay`, () => import('@/app/api/admin/seat-reservations/[id]/pay/route'),
      { paymentType: 'card' }, { params: { id: found.id } });
    const p = await pay();
    expect(p.status, p.text).toBe(200);
    expect(p.json.tickets).toHaveLength(2);
    expect(p.json.receiptNumber).toMatch(/^\d{4}-\d{4}$/);
    const o = (await clone.pool.query(
      `SELECT o.status, o.payment_provider, o.is_box_office, s.payment_type, s.receipt_number, r.status AS res_status, r.payment_type AS res_pay,
              (SELECT COUNT(*)::int FROM tickets.tickets t WHERE t.order_id = o.id) AS tickets,
              (SELECT COUNT(*)::int FROM orders.invoices i WHERE i.order_id = o.id AND i.doc_type = 'invoice') AS docs
         FROM orders.orders o JOIN orders.seat_reservations r ON r.order_id = o.id
         JOIN orders.box_office_sales s ON s.order_id = o.id AND s.receipt_number IS NOT NULL
        WHERE r.code = $1`, [code])).rows[0];
    expect(o).toEqual({
      status: 'paid', payment_provider: 'box_office', is_box_office: true, payment_type: 'card', receipt_number: `REZ-${code}`,
      res_status: 'paid', res_pay: 'card', tickets: 2, docs: 1,
    });
    await mailFor(email, 'vstupenk');
    const again = await pay();
    expect(again.status).toBe(409);
    expect(again.json.error).toBe('NOT_ACTIVE');
  });

  it('lhůta se vynucuje na serveru i bez cronu; cron (dispatcher) uvolní propadlé + e-mail; expire-pending-orders rezervaci nebere', async () => {
    const email = `exp-${randomUUID().slice(0, 6)}@tixly.test`;
    const r = await reserve([6, 7], email);
    expect(r.status, r.text).toBe(200);
    const code = String(r.json.reservationCode);
    await clone.pool.query(`UPDATE orders.seat_reservations SET expires_at = now() - interval '1 minute' WHERE code=$1`, [code]);
    await clone.pool.query(`UPDATE orders.orders SET expires_at = now() - interval '1 minute' WHERE id=$1`, [r.json.orderId]);
    const id = (await clone.pool.query(`SELECT id FROM orders.seat_reservations WHERE code=$1`, [code])).rows[0].id;
    const p = await admin('POST', `/api/admin/seat-reservations/${id}/pay`, () => import('@/app/api/admin/seat-reservations/[id]/pay/route'),
      { paymentType: 'cash' }, { params: { id } });
    expect(p.status).toBe(409);
    expect(p.json.error).toBe('RESERVATION_EXPIRED');

    // obecný cron nezaplacených objednávek rezervaci nechá (bez e-mailu by kupec nevěděl, že propadla)
    const { POST: expirePending } = await import('@/app/api/internal/cron/expire-pending-orders/route');
    const ep = await (expirePending as unknown as H)(new Request('http://localhost/api/internal/cron/expire-pending-orders', {
      method: 'POST', headers: { 'x-internal-token': process.env.INTERNAL_SERVICE_TOKEN ?? '' },
    }) as unknown as NextRequest);
    expect(ep.status).toBe(200);
    expect((await clone.pool.query(`SELECT status FROM orders.orders WHERE id=$1`, [r.json.orderId])).rows[0].status).toBe('pending');

    // cron bez CRON_SECRET neprojde
    const { GET: dispatch } = await import('@/app/api/cron/dispatch/route');
    expect((await throughMiddleware(new Request('http://localhost/api/cron/dispatch?job=seat-reservations'), dispatch as H)).status).toBe(403);
    const res = await cron();
    expect(res.expired).toBeGreaterThanOrEqual(1);
    expect(await seatStatus(6)).toEqual({ status: 'available', order_id: null });
    const st = (await clone.pool.query(
      `SELECT r.status, o.status AS order_status FROM orders.seat_reservations r JOIN orders.orders o ON o.id = r.order_id WHERE r.code=$1`, [code])).rows[0];
    expect(st).toEqual({ status: 'expired', order_status: 'expired' });
    const m = await mailFor(email, 'vypršela');
    expect(m.html).toContain('uvolnili');
  });

  it('připomínka 24 h před koncem lhůty, jen jednou', async () => {
    const email = `rem-${randomUUID().slice(0, 6)}@tixly.test`;
    const r = await reserve([8], email);
    const code = String(r.json.reservationCode);
    await clone.pool.query(
      `UPDATE orders.seat_reservations SET created_at = now() - interval '4 days', expires_at = now() + interval '20 hours' WHERE code=$1`, [code]);
    expect((await cron()).reminded).toBeGreaterThanOrEqual(1);
    const m = await mailFor(email, 'Připomínka');
    expect(m.html).toContain(code);
    const again = await cron();
    expect((await clone.pool.query(`SELECT reminded_at IS NOT NULL AS r FROM orders.seat_reservations WHERE code=$1`, [code])).rows[0].r).toBe(true);
    expect(again.reminded).toBe(0);
  });

  it('zrušení odkazem z e-mailu; špatný token neprojde; místa zpět', async () => {
    const email = `zrus-${randomUUID().slice(0, 6)}@tixly.test`;
    const r = await reserve([9], email);
    const code = String(r.json.reservationCode);
    const m = await mailFor(email, code);
    const token = decodeURIComponent(/token=([A-Za-z0-9_%-]+)/.exec(m.html)![1]);
    const { POST } = await import('@/app/api/public/seat-reservations/cancel/route');
    const call = (body: unknown) => (POST as unknown as H)(new Request('http://localhost/api/public/seat-reservations/cancel', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip() }, body: JSON.stringify(body),
    }) as unknown as NextRequest);
    expect((await call({ code, token: 'x'.repeat(32) })).status).toBe(404);
    const ok = await call({ code, token });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await seatStatus(9)).toEqual({ status: 'available', order_id: null });
    expect((await clone.pool.query(`SELECT status FROM orders.seat_reservations WHERE code=$1`, [code])).rows[0].status).toBe('cancelled');
    await mailFor(email, 'zrušená');
    expect((await call({ code, token })).status).toBe(409);
  });

  it('limity: max 2 aktivní rezervace a 10 míst na e-mail a termín — i při souběhu', async () => {
    const a = `lim-${randomUUID().slice(0, 6)}@tixly.test`;
    expect((await reserve([10], a)).status).toBe(200);
    // souběžně dvě další: projde právě jedna
    const both = await Promise.all([reserve([11], a), reserve([12], a)]);
    expect(both.map((x) => x.status).sort()).toEqual([200, 422]);
    expect(both.find((x) => x.status === 422)!.json.error).toBe('RESERVATION_LIMIT');

    const b = `lim2-${randomUUID().slice(0, 6)}@tixly.test`;
    expect((await reserve([20, 21, 22, 23, 24, 25], b)).status).toBe(200);
    const over = await reserve([26, 27, 28, 29, 30], b);
    expect(over.status).toBe(422);
    expect(over.json.error).toBe('RESERVATION_SEAT_LIMIT');
  });

  it('obsazenost: rezervace se počítají do obsazenosti, ale zvlášť od prodaných', async () => {
    const g = await admin('GET', `/api/admin/events/${c.eventId}/reservations`, () => import('@/app/api/admin/events/[id]/reservations/route'), undefined, { params: { id: c.eventId } });
    expect(g.status, g.text).toBe(200);
    const active = (await clone.pool.query(`SELECT COALESCE(SUM(seat_count),0)::int AS n FROM orders.seat_reservations WHERE event_id=$1 AND status='active'`, [c.eventId])).rows[0].n;
    const occ = g.json.occupancy as { capacity: number; sold: number; reserved: number; occupiedPct: number };
    expect(occ.reserved).toBe(active);
    expect(occ.sold).toBe(2); // zaplacená rezervace = prodáno
    expect(occ.occupiedPct).toBe(Math.round(((occ.sold + occ.reserved) / 40) * 1000) / 10);
  });

  it('existující prodej na pokladně (box-office/sell) funguje v kontextu pořadatele pod tixly_app a vystaví vstupenku', async () => {
    const sid = (await clone.pool.query<{ id: string }>(
      `INSERT INTO orders.box_office_sessions (event_id, cashier_user_id) VALUES ($1, $2) RETURNING id`, [c.eventId, c.adminUserId])).rows[0].id;
    const tt = (await clone.pool.query<{ id: string }>(
      `INSERT INTO catalog.ticket_types (event_id, name, kind, base_price, total_qty, remaining_qty, visibility, vat_rate_code)
       VALUES ($1, 'Na stání', 'standing', 20000, 10, 10, 'public', 'CZ_REDUCED') RETURNING id`, [c.eventId])).rows[0].id;
    const r = await admin('POST', `/api/admin/events/${c.eventId}/box-office/sell`, () => import('@/app/api/admin/events/[id]/box-office/sell/route'),
      { sessionId: sid, ticketTypeId: tt, quantity: 1, paymentType: 'cash', cashTenderedHalire: 50000 }, { params: { id: c.eventId } });
    expect(r.status, r.text).toBe(201);
    expect(r.json.changeHalire).toBe(30000);
    expect(r.json.tickets).toHaveLength(1);
    expect((await clone.pool.query(`SELECT COUNT(*)::int AS n FROM tickets.tickets WHERE order_id=$1`, [r.json.orderId])).rows[0].n).toBe(1);
  });

  it('POS prodej zapíše způsob platby do evidence pokladny', async () => {
    const r = await admin('POST', '/api/admin/pos/sale', () => import('@/app/api/admin/pos/sale/route'),
      { eventId: c.eventId, ticketTypeId: c.ticketTypeId, quantity: 1, seatIds: [seat[39]], paymentMethod: 'card_terminal' });
    expect(r.status, r.text).toBe(200);
    const s = (await clone.pool.query(
      `SELECT s.payment_type, o.payment_provider, o.is_box_office FROM orders.box_office_sales s JOIN orders.orders o ON o.id = s.order_id WHERE s.order_id=$1`,
      [r.json.orderId])).rows;
    expect(s).toEqual([{ payment_type: 'card', payment_provider: 'box_office', is_box_office: true }]);
  });
});
