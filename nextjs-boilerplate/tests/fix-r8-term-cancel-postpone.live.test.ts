// @vitest-environment node
/**
 * Kolo 8 / krok 7 — zrušení a přesun termínu (C-14).
 *
 * Očekávané:
 *   - zrušení: prodej i rezervace stojí, online platby vrácené přes bránu (hromadný refund), dobropis k dokladu,
 *     vstupenky neplatné, e-mail kupcům; platby na pokladně a firemní faktury v seznamu k ručnímu vrácení;
 *   - souběh: nákup rozpracovaný při zrušení (platba dorazí potom / zároveň) → vrácen, žádná platná vstupenka;
 *   - přesun: vstupenky platí, e-mail s novým datem a odkazem na vrácení s lhůtou (výchozí 14 dní);
 *     žádost jde existující cestou refundu (online přes bránu, pokladna → ručně), po lhůtě 410.
 */
import { randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx?: unknown) => Promise<Response>;
const FAKE = process.env.FIX_GOPAY_URL ?? 'http://localhost:3998';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:58225';

run('Kolo 8 — zrušení a přesun termínu', () => {
  let clone: LocalClone;
  let tok: string;
  const realFetch = globalThis.fetch;

  interface Term { eventId: string; ttId: string; seats: string[]; cat: Record<string, string> }
  let promoter: Awaited<ReturnType<LocalClone['seed']['chain']>>;

  const call = async (method: string, url: string, mod: () => Promise<Record<string, unknown>>, body?: unknown, ctx: unknown = {}, token = tok) => {
    const m = await mod();
    const r = await throughMiddleware(new Request(`http://localhost${url}`, {
      method, headers: { 'content-type': 'application/json', origin: 'http://localhost', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), m[method] as H, ctx);
    const text = await r.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text); } catch { /* */ }
    return { status: r.status, json, text };
  };
  const ip = () => `198.51.170.${Math.floor(Math.random() * 250) + 1}`;
  const mails = async (to: string, subjectPart: string) => {
    for (let i = 0; i < 40; i++) {
      const j = await (await realFetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent('to:' + to)}&limit=20`)).json() as { messages?: Array<{ ID: string; Subject: string }> };
      const hit = j.messages?.find((m) => m.Subject.includes(subjectPart));
      if (hit) return { id: hit.ID, subject: hit.Subject, html: ((await (await realFetch(`${MAILPIT}/api/v1/message/${hit.ID}`)).json()) as { HTML?: string }).HTML ?? '' };
      await new Promise((res) => setTimeout(res, 250));
    }
    throw new Error(`mail „${subjectPart}" pro ${to} nedorazil`);
  };

  async function term(): Promise<Term> {
    const eventId = randomUUID();
    await clone.pool.query(
      `INSERT INTO catalog.events (id, organizer_id, promoter_id, venue_id, title, slug, status, currency, event_type, date_start, date_end)
       VALUES ($1,$2,$2,$3,'Hamlet',$4,'published','CZK','theatre', now() + interval '20 days', now() + interval '20 days 3 hours')`,
      [eventId, promoter.promoterId, promoter.venueId, `hamlet-${eventId.slice(0, 8)}`]);
    const ttId = (await clone.pool.query<{ id: string }>(
      `INSERT INTO catalog.ticket_types (event_id, name, kind, base_price, total_qty, remaining_qty, visibility, vat_rate_code, zone, is_seated)
       VALUES ($1,'Přízemí','standing',40000,20,20,'public','CZ_REDUCED','Přízemí',true) RETURNING id`, [eventId])).rows[0].id;
    const seats: string[] = [];
    for (let n = 1; n <= 20; n++) {
      seats.push((await clone.pool.query<{ id: string }>(
        `INSERT INTO catalog.event_seats (event_id, ticket_type_id, sector, row, seat_number, x_coord, y_coord, status)
         VALUES ($1,$2,'Přízemí','1',$3,$4,10,'available') RETURNING id`, [eventId, ttId, String(n), n * 20])).rows[0].id);
    }
    const t = await call('POST', `/api/admin/events/${eventId}/categories`, () => import('@/app/api/admin/events/[id]/categories/route'), { applyTemplate: true }, { params: { id: eventId } });
    const cat: Record<string, string> = {};
    for (const x of t.json.categories as Array<{ id: string; code: string }>) cat[x.code] = x.id;
    return { eventId, ttId, seats, cat };
  }
  async function hold(t: Term, ids: number[]) {
    const { POST } = await import('@/app/api/events/[id]/seats/hold/route');
    const r = await (POST as unknown as H)(new Request(`http://localhost/api/events/${t.eventId}/seats/hold`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip() }, body: JSON.stringify({ seatIds: ids.map((i) => t.seats[i]) }),
    }) as unknown as NextRequest, { params: { id: t.eventId } });
    return ((await r.json()) as { holdToken: string }).holdToken;
  }
  async function checkout(t: Term, ids: number[], email: string, extra: Record<string, unknown> = {}) {
    const token = await hold(t, ids);
    const { POST } = await import('@/app/api/checkout/seats/route');
    const r = await (POST as unknown as H)(new Request('http://localhost/api/checkout/seats', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip() },
      body: JSON.stringify({ eventId: t.eventId, seatHoldToken: token, items: ids.map((i) => ({ seatId: t.seats[i], categoryId: t.cat.plne })), buyerEmail: email, buyerName: 'Divák Testovací', ...extra }),
    }) as unknown as NextRequest);
    const j = await r.json() as Record<string, unknown>;
    expect(r.status, JSON.stringify(j)).toBe(200);
    return j as { orderId: string; paymentId?: string; reservationCode?: string };
  }
  async function pay(paymentId: string) {
    await realFetch(`${FAKE}/_ctl/${paymentId}`, { method: 'POST', body: JSON.stringify({ state: 'PAID' }) });
    const { GET: webhook } = await import('@/app/api/payments/gopay/webhook/route');
    return (webhook as unknown as H)(new Request(`http://localhost/api/payments/gopay/webhook?id=${paymentId}`) as unknown as NextRequest);
  }
  const validTickets = async (orderId: string) => (await clone.pool.query(`SELECT COUNT(*)::int AS n FROM tickets.tickets WHERE order_id=$1 AND status='valid'`, [orderId])).rows[0].n as number;
  const orderStatus = async (orderId: string) => (await clone.pool.query(`SELECT status FROM orders.orders WHERE id=$1`, [orderId])).rows[0].status as string;
  async function waitTickets(orderId: string, n: number) {
    for (let i = 0; i < 40 && (await validTickets(orderId)) < n; i++) await new Promise((res) => setTimeout(res, 250));
    expect(await validTickets(orderId)).toBe(n);
  }

  beforeAll(async () => {
    clone = await createLocalClone();
    promoter = await clone.seed.chain();
    await clone.pool.query(`UPDATE platform.promoters SET company_ico = '12345678', company_address = 'Celetná 17, 110 00 Praha 1' WHERE id = $1`, [promoter.promoterId]);
    const { signAccessToken } = await import('@/lib/auth');
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [promoter.adminUserId])).rows[0].email;
    tok = await signAccessToken({ id: promoter.adminUserId, email, name: 'U' } as never, {
      isPlatformAdmin: false, promoterMemberships: [{ promoterId: promoter.promoterId, slug: 'x', name: 'x', status: 'active', role: 'owner' }],
    } as never);
  }, 120_000);
  afterAll(async () => { globalThis.fetch = realFetch; await clone?.cleanup(); }, 60_000);

  it('zrušení: online vráceno přes bránu + dobropis, rozpracované nákupy a rezervace zrušené, vstupenky neplatné, e-maily, ruční seznam', async () => {
    const t = await term();
    // 1) online zaplaceno + doklad kupci
    const online = `online-${randomUUID().slice(0, 6)}@tixly.test`;
    const o1 = await checkout(t, [0, 1], online);
    expect((await pay(o1.paymentId!)).status).toBe(200);
    await waitTickets(o1.orderId, 2);
    const { issueOrderDocument } = await import('@/lib/accounting/documents');
    await issueOrderDocument(clone.pool as never, o1.orderId);
    // 2) rozpracovaný nákup (zaplatí se až po zrušení)
    const late = await checkout(t, [2], `late-${randomUUID().slice(0, 6)}@tixly.test`);
    // 3) prodej na pokladně (hotově)
    const pos = await call('POST', '/api/admin/pos/sale', () => import('@/app/api/admin/pos/sale/route'),
      { eventId: t.eventId, ticketTypeId: t.ttId, quantity: 1, seatIds: [t.seats[3]], paymentMethod: 'cash', buyerName: 'Pokladní divák' });
    expect(pos.status, pos.text).toBe(200);
    // 4) aktivní rezervace na pokladně
    await call('PATCH', `/api/admin/events/${t.eventId}/reservations`, () => import('@/app/api/admin/events/[id]/reservations/route'), { enabled: true }, { params: { id: t.eventId } });
    const resEmail = `rez-${randomUUID().slice(0, 6)}@tixly.test`;
    const res = await checkout(t, [4], resEmail, { paymentMethod: 'box_office_reservation' });
    // 5) firemní: zaplacená a nezaplacená
    const corp = (body: Record<string, unknown>) => call('POST', '/api/admin/corporate-orders', () => import('@/app/api/admin/corporate-orders/route'), {
      eventId: t.eventId, company: { name: 'Firma XY s.r.o.', ico: '27082440', address: 'Praha 1' }, contact: { name: 'Jan', email: `corp-${randomUUID().slice(0, 6)}@firma.test` },
      dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10), ...body,
    });
    const cPaid = await corp({ seats: [5, 6].map((i) => ({ seatId: t.seats[i], categoryId: t.cat.plne })) });
    expect(cPaid.status, cPaid.text).toBe(201);
    await call('POST', `/api/admin/corporate-orders/${String(cPaid.json.id)}/paid`, () => import('@/app/api/admin/corporate-orders/[id]/paid/route'),
      { paidOn: new Date().toISOString().slice(0, 10), paymentReference: 'VS1' }, { params: { id: cPaid.json.id } });
    const cOpen = await corp({ seats: [{ seatId: t.seats[7], categoryId: t.cat.plne }] });
    expect(cOpen.status, cOpen.text).toBe(201);

    const c = await call('POST', `/api/admin/events/${t.eventId}/cancel-term`, () => import('@/app/api/admin/events/[id]/cancel-term/route'),
      { reason: 'Onemocnění v souboru' }, { params: { id: t.eventId } });
    expect(c.status, c.text).toBe(200);
    expect(c.json).toMatchObject({ refunded: 1, refundFailed: 0, corporateCancelled: 1, reservationsCancelled: 1 });
    expect(c.json.pendingCancelled).toBeGreaterThanOrEqual(2); // rozpracovaný nákup + rezervace

    expect(await orderStatus(o1.orderId)).toBe('refunded');
    expect(await validTickets(o1.orderId)).toBe(0);
    const note = (await clone.pool.query(`SELECT total_minor::int AS t FROM orders.invoices WHERE order_id=$1 AND doc_type='credit_note'`, [o1.orderId])).rows;
    expect(note).toEqual([{ t: -80000 }]);
    expect(await orderStatus(late.orderId)).toBe('cancelled');
    expect(await orderStatus(res.orderId)).toBe('cancelled');
    expect(await validTickets(String(pos.json.orderId))).toBe(0);
    expect(await validTickets(String(cPaid.json.orderId))).toBe(0);
    expect((await clone.pool.query(`SELECT status FROM b2b_orders.invoice_orders WHERE id=$1`, [cOpen.json.id])).rows[0].status).toBe('cancelled');
    const ev = (await clone.pool.query(`SELECT status, cancellation_reason, reservations_enabled FROM catalog.events WHERE id=$1`, [t.eventId])).rows[0];
    expect(ev).toEqual({ status: 'cancelled', cancellation_reason: 'Onemocnění v souboru', reservations_enabled: false });

    const manual = c.json.manualRefunds as Array<{ orderId: string; channel: string; paymentType: string | null; invoiceNumber: string | null }>;
    expect(manual.find((m) => m.orderId === pos.json.orderId)).toMatchObject({ channel: 'box_office', paymentType: 'cash' });
    expect(manual.find((m) => m.orderId === cPaid.json.orderId)?.channel).toBe('corporate');
    expect(manual.find((m) => m.orderId === cPaid.json.orderId)?.invoiceNumber).toBeTruthy();
    expect(manual.some((m) => m.orderId === o1.orderId)).toBe(false);

    expect((await mails(online, 'Zrušeno')).html).toContain('vrátili');
    expect((await mails(resEmail, 'Zrušeno')).html).toContain(String(res.reservationCode));

    // prodej po zrušení stojí
    const { POST: holdRoute } = await import('@/app/api/events/[id]/seats/hold/route');
    const h = await (holdRoute as unknown as H)(new Request(`http://localhost/api/events/${t.eventId}/seats/hold`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip() }, body: JSON.stringify({ seatIds: [t.seats[10]] }),
    }) as unknown as NextRequest, { params: { id: t.eventId } });
    if (h.status === 200) {
      const { POST } = await import('@/app/api/checkout/seats/route');
      const r = await (POST as unknown as H)(new Request('http://localhost/api/checkout/seats', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip() },
        body: JSON.stringify({ eventId: t.eventId, seatHoldToken: ((await h.json()) as { holdToken: string }).holdToken, items: [{ seatId: t.seats[10], categoryId: t.cat.plne }], buyerEmail: 'x@tixly.test', buyerName: 'X' }),
      }) as unknown as NextRequest);
      expect(r.status).toBe(404);
    } else {
      expect(h.status).toBeGreaterThanOrEqual(400);
    }

    // souběh: rozpracovaný nákup zaplacený PO zrušení → automaticky vrácen, žádná vstupenka
    expect((await pay(late.paymentId!)).status).toBe(200);
    expect(await orderStatus(late.orderId)).toBe('refunded');
    expect(await validTickets(late.orderId)).toBe(0);

    // podruhé zrušit nejde
    expect((await call('POST', `/api/admin/events/${t.eventId}/cancel-term`, () => import('@/app/api/admin/events/[id]/cancel-term/route'), { reason: 'znovu' }, { params: { id: t.eventId } })).status).toBe(409);
  }, 120_000);

  it('souběh: zrušení ve stejné chvíli, kdy dorazí platba → vráceno, žádná platná vstupenka', async () => {
    const t = await term();
    const buyers = await Promise.all([0, 1, 2].map((i) => checkout(t, [i], `race${i}-${randomUUID().slice(0, 6)}@tixly.test`)));
    const [cancel] = await Promise.all([
      call('POST', `/api/admin/events/${t.eventId}/cancel-term`, () => import('@/app/api/admin/events/[id]/cancel-term/route'), { reason: 'Souběh' }, { params: { id: t.eventId } }),
      ...buyers.map((b) => pay(b.paymentId!)),
    ]);
    expect(cancel.status, cancel.text).toBe(200);
    // dokončení vrácení u plateb, které doběhly v mezičase
    await new Promise((res) => setTimeout(res, 1000));
    for (const b of buyers) {
      expect(['refunded', 'cancelled']).toContain(await orderStatus(b.orderId));
      expect(await validTickets(b.orderId)).toBe(0);
    }
    expect((await clone.pool.query(`SELECT COUNT(*)::int AS n FROM tickets.tickets t JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id WHERE tt.event_id=$1 AND t.status='valid'`, [t.eventId])).rows[0].n).toBe(0);
  }, 120_000);

  it('přesun: vstupenky platí, e-mail s novým datem a odkazem (14 dní); online vrácení přes bránu, pokladna ručně, po lhůtě 410', async () => {
    const t = await term();
    const online = `pres-${randomUUID().slice(0, 6)}@tixly.test`;
    const o1 = await checkout(t, [0, 1], online);
    await pay(o1.paymentId!);
    await waitTickets(o1.orderId, 2);
    const keep = `keep-${randomUUID().slice(0, 6)}@tixly.test`;
    const o2 = await checkout(t, [2], keep);
    await pay(o2.paymentId!);
    await waitTickets(o2.orderId, 1);
    const pos = await call('POST', '/api/admin/pos/sale', () => import('@/app/api/admin/pos/sale/route'),
      { eventId: t.eventId, ticketTypeId: t.ttId, quantity: 1, seatIds: [t.seats[3]], paymentMethod: 'card_terminal' });
    expect(pos.status).toBe(200);

    const newStart = new Date(Date.now() + 45 * 86_400_000);
    newStart.setUTCHours(18, 0, 0, 0);
    const p = await call('POST', `/api/admin/events/${t.eventId}/postpone-term`, () => import('@/app/api/admin/events/[id]/postpone-term/route'),
      { newStart: newStart.toISOString(), reason: 'Rekonstrukce jeviště' }, { params: { id: t.eventId } });
    expect(p.status, p.text).toBe(200);
    expect(p.json.recipients).toBe(3);
    expect(Math.abs(new Date(p.json.responseDeadline as string).getTime() - (Date.now() + 14 * 86_400_000))).toBeLessThan(120_000);
    const ev = (await clone.pool.query(`SELECT date_start, original_date_start IS NOT NULL AS had, status FROM catalog.events WHERE id=$1`, [t.eventId])).rows[0];
    expect(new Date(ev.date_start).toISOString()).toBe(newStart.toISOString());
    expect(ev).toMatchObject({ had: true, status: 'published' });
    expect(await validTickets(o1.orderId)).toBe(2);

    const m = await mails(online, 'Změna termínu');
    expect(m.html).toContain('zůstávají platné');
    const token = /reschedule\/([0-9a-f]+)/.exec(m.html)![1];
    const { GET, POST } = await import('@/app/api/reschedule/[token]/route');
    const g = await (GET as unknown as (r: NextRequest, c: unknown) => Promise<Response>)(new Request(`http://localhost/api/reschedule/${token}`) as unknown as NextRequest, { params: Promise.resolve({ token }) });
    expect(g.status).toBe(200);
    expect(((await g.json()) as { offerRefund: boolean }).offerRefund).toBe(true);
    const ask = (tk: string) => (POST as unknown as (r: NextRequest, c: unknown) => Promise<Response>)(new Request(`http://localhost/api/reschedule/${tk}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ response: 'refund_requested' }),
    }) as unknown as NextRequest, { params: Promise.resolve({ token: tk }) });
    const r = await ask(token);
    expect(r.status, await r.clone().text()).toBe(200);
    expect(((await r.json()) as { refund: string }).refund).toBe('refunded');
    expect(await orderStatus(o1.orderId)).toBe('refunded');
    expect(await validTickets(o1.orderId)).toBe(0);
    expect(await validTickets(o2.orderId)).toBe(1); // kdo nežádal, má platnou vstupenku

    // platba na pokladně → ruční vrácení
    const posToken = (await clone.pool.query(`SELECT response_token FROM orders.reschedule_responses WHERE order_id=$1`, [pos.json.orderId])).rows[0].response_token as string;
    const rp = await ask(posToken);
    expect(((await rp.json()) as { refund: string }).refund).toBe('manual');
    expect(await orderStatus(String(pos.json.orderId))).toBe('paid');

    // po lhůtě odkaz neplatí
    const keepToken = (await clone.pool.query(`SELECT response_token FROM orders.reschedule_responses WHERE order_id=$1`, [o2.orderId])).rows[0].response_token as string;
    await clone.pool.query(`UPDATE catalog.event_reschedules SET response_deadline = now() - interval '1 minute' WHERE id=$1`, [p.json.rescheduleId]);
    expect((await ask(keepToken)).status).toBe(410);
    expect(await validTickets(o2.orderId)).toBe(1);
  }, 120_000);

  it('cizí pořadatel termín nezruší ani nepřesune', async () => {
    const t = await term();
    const other = await clone.seed.chain();
    const { signAccessToken } = await import('@/lib/auth');
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [other.adminUserId])).rows[0].email;
    const t2 = await signAccessToken({ id: other.adminUserId, email, name: 'O' } as never, {
      isPlatformAdmin: false, promoterMemberships: [{ promoterId: other.promoterId, slug: 'o', name: 'o', status: 'active', role: 'owner' }],
    } as never);
    expect((await call('POST', `/api/admin/events/${t.eventId}/cancel-term`, () => import('@/app/api/admin/events/[id]/cancel-term/route'), { reason: 'cizí' }, { params: { id: t.eventId } }, t2)).status).toBe(404);
    expect((await call('POST', `/api/admin/events/${t.eventId}/postpone-term`, () => import('@/app/api/admin/events/[id]/postpone-term/route'),
      { newStart: new Date(Date.now() + 50 * 86_400_000).toISOString(), reason: 'cizí' }, { params: { id: t.eventId } }, t2)).status).toBe(404);
    expect((await clone.pool.query(`SELECT status FROM catalog.events WHERE id=$1`, [t.eventId])).rows[0].status).toBe('published');
  });
});
