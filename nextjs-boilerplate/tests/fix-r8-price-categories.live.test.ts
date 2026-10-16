// @vitest-environment node
/**
 * Kolo 8 / krok 4 — slevové kategorie u míst.
 *
 * Očekávané:
 *   - kategorie s cenou pro každou zónu (procento z plné / pevná částka), výchozí šablona jedním krokem;
 *   - kupec vybírá kategorii u každého místa, cena se počítá na serveru (podstrčená cena se ignoruje);
 *   - doprovod ZTP/P jen se ZTP/P ve stejné objednávce, max. 1 doprovod na 1 ZTP/P; limit kusů kategorie na termín;
 *   - promo kód se počítá z ceny kategorie a jde omezit na kategorie a zóny (a patří pořadateli termínu);
 *   - vstupenka (PDF, e-mail) ukazuje kategorii; skener u kategorie s nárokem hlásí „Ověřit průkaz: ZTP/P".
 */
import { randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalClone, hasLocalDb, mailpitLatest, type LocalClone } from './helpers/local-fixture';
import { pdfText } from './helpers/pdf-text';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx?: unknown) => Promise<Response>;
const FAKE = process.env.FIX_GOPAY_URL ?? 'http://localhost:3998';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:58225';

run('Kolo 8 — slevové kategorie', () => {
  let clone: LocalClone;
  let c: Awaited<ReturnType<LocalClone['seed']['chain']>>;
  let tok: string;
  let zoneB = '';
  const seat: Record<string, string> = {};
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
  const ip = () => `198.51.150.${Math.floor(Math.random() * 250) + 1}`;
  async function hold(ids: string[]) {
    const { POST } = await import('@/app/api/events/[id]/seats/hold/route');
    const r = await (POST as unknown as H)(new Request(`http://localhost/api/events/${c.eventId}/seats/hold`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip() }, body: JSON.stringify({ seatIds: ids }),
    }) as unknown as NextRequest, { params: Promise.resolve({ id: c.eventId }) });
    const j = await r.json() as { holdToken: string };
    expect(r.status, JSON.stringify(j)).toBe(200);
    return j.holdToken;
  }
  async function buy(items: Array<{ seatId: string; categoryId: string; priceMinor?: number }>, extra: Record<string, unknown> = {}) {
    const token = await hold(items.map((i) => i.seatId));
    const { POST } = await import('@/app/api/checkout/seats/route');
    const email = `kat-${randomUUID().slice(0, 6)}@tixly.test`;
    const r = await (POST as unknown as H)(new Request('http://localhost/api/checkout/seats', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip() },
      body: JSON.stringify({ eventId: c.eventId, seatHoldToken: token, items, buyerEmail: email, buyerName: 'Kupec Kategorie', ...extra }),
    }) as unknown as NextRequest);
    const text = await r.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text); } catch { /* */ }
    return { status: r.status, json, text, email };
  }

  beforeAll(async () => {
    clone = await createLocalClone();
    c = await clone.seed.chain({ totalQty: 10, remainingQty: 10, basePrice: 50000 });
    await clone.pool.query(`UPDATE catalog.ticket_types SET is_seated = true, zone = 'Zóna A', name = 'Zóna A' WHERE id=$1`, [c.ticketTypeId]);
    zoneB = (await clone.pool.query<{ id: string }>(
      `INSERT INTO catalog.ticket_types (event_id, name, kind, base_price, total_qty, remaining_qty, visibility, vat_rate_code, zone, is_seated)
       VALUES ($1,'Zóna B','standing',30000,10,10,'public','CZ_REDUCED','Zóna B', true) RETURNING id`, [c.eventId])).rows[0].id;
    for (const [zone, tt] of [['A', c.ticketTypeId], ['B', zoneB]] as const) {
      for (let n = 1; n <= 10; n++) {
        seat[`${zone}${n}`] = (await clone.pool.query<{ id: string }>(
          `INSERT INTO catalog.event_seats (event_id, ticket_type_id, sector, row, seat_number, x_coord, y_coord, status, price_zone)
           VALUES ($1,$2,'Přízemí',$3,$4,$5,10,'available',$6) RETURNING id`, [c.eventId, tt, zone, String(n), n * 20, `Zóna ${zone}`])).rows[0].id;
      }
    }
    const { signAccessToken } = await import('@/lib/auth');
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [c.adminUserId])).rows[0].email;
    tok = await signAccessToken({ id: c.adminUserId, email, name: 'U' } as never, {
      isPlatformAdmin: false, promoterMemberships: [{ promoterId: c.promoterId, slug: 'x', name: 'x', status: 'active', role: 'owner' }],
    } as never);
    // order-completed (vydání vstupenek + e-mail s PDF) doručíme in-process skutečnému handleru
    const { POST: completed } = await import('@/app/api/internal/order-completed/route');
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (u.pathname === '/api/internal/order-completed') return completed(new Request(`http://localhost${u.pathname}`, init) as unknown as NextRequest);
      return realFetch(input, init);
    }) as typeof fetch;
  }, 120_000);
  afterAll(async () => { globalThis.fetch = realFetch; await clone?.cleanup(); }, 60_000);

  it('výchozí šablona jedním krokem; ceny kategorií v zónách; výjimka pro zónu', async () => {
    const r = await admin('POST', `/api/admin/events/${c.eventId}/categories`, () => import('@/app/api/admin/events/[id]/categories/route'),
      { applyTemplate: true }, { params: Promise.resolve({ id: c.eventId }) });
    expect(r.status, r.text).toBe(201);
    expect(r.json.applied).toBe(7);
    for (const x of r.json.categories as Array<{ id: string; code: string }>) cat[x.code] = x.id;
    // senior v zóně B pevně 200 Kč, dítě max 1 kus na termín
    const p = await admin('PUT', `/api/admin/events/${c.eventId}/categories/${cat.senior}/prices`, () => import('@/app/api/admin/events/[id]/categories/[categoryId]/prices/route'),
      { ticketTypeId: zoneB, priceMode: 'fixed', priceValue: 20000 }, { params: Promise.resolve({ id: c.eventId, categoryId: cat.senior }) });
    expect(p.status, p.text).toBe(200);
    await admin('POST', `/api/admin/events/${c.eventId}/categories`, () => import('@/app/api/admin/events/[id]/categories/route'),
      { code: 'dite', name: 'Dítě', kind: 'child', priceMode: 'percent', priceValue: 5000, limitPerEvent: 1 }, { params: Promise.resolve({ id: c.eventId }) });
    const pub = await (await import('@/app/api/public/events/[id]/seat-prices/route')).GET(
      new Request(`http://localhost/api/public/events/${c.eventId}/seat-prices`) as unknown as NextRequest, { params: Promise.resolve({ id: c.eventId }) });
    const pj = await pub.json() as { prices: Array<{ categoryId: string; ticketTypeId: string; priceMinor: number }>; seats: unknown[] };
    const price = (code: string, tt: string) => pj.prices.find((x) => x.categoryId === cat[code] && x.ticketTypeId === tt)!.priceMinor;
    expect(price('plne', c.ticketTypeId)).toBe(50000);
    expect(price('student', zoneB)).toBe(21000);
    expect(price('senior', zoneB)).toBe(20000);
    expect(price('senior', c.ticketTypeId)).toBe(40000);
    expect(price('doprovod-ztpp', c.ticketTypeId)).toBe(0);
    expect(pj.seats).toHaveLength(20);
  });

  it('pravidla doprovodu ZTP/P', async () => {
    const r1 = await buy([{ seatId: seat.A9, categoryId: cat['doprovod-ztpp'] }]);
    expect(r1.status, r1.text).toBe(422);
    expect(r1.json.error).toBe('COMPANION_WITHOUT_ZTPP');
    const r2 = await buy([
      { seatId: seat.B8, categoryId: cat.ztpp }, { seatId: seat.B9, categoryId: cat['doprovod-ztpp'] }, { seatId: seat.B10, categoryId: cat['doprovod-ztpp'] },
    ]);
    expect(r2.status).toBe(422);
    expect(r2.json.error).toBe('TOO_MANY_COMPANIONS');
  });

  it('limit kategorie na termín', async () => {
    const ok = await buy([{ seatId: seat.B7, categoryId: cat.dite }]);
    expect(ok.status, ok.text).toBe(200);
    const no = await buy([{ seatId: seat.B6, categoryId: cat.dite }]);
    expect(no.status).toBe(422);
    expect(no.json.error).toBe('CATEGORY_LIMIT');
  });

  it('objednávka za 0 Kč (kategorie zdarma) se dokončí bez brány a vystaví vstupenku', async () => {
    const k = await admin('POST', `/api/admin/events/${c.eventId}/categories`, () => import('@/app/api/admin/events/[id]/categories/route'),
      { code: 'zdarma', name: 'Čestná', kind: 'custom', priceMode: 'fixed', priceValue: 0 }, { params: Promise.resolve({ id: c.eventId }) });
    expect(k.status, k.text).toBe(201);
    const r = await buy([{ seatId: seat.A10, categoryId: k.json.id as string }]);
    expect(r.status, r.text).toBe(200);
    expect(r.json.provider).toBe('free');
    const t = await clone.pool.query(`SELECT t.price_category_name FROM tickets.tickets t WHERE t.order_id = $1`, [r.json.orderId]);
    expect(t.rows.map((x) => x.price_category_name)).toEqual(['Čestná']);
  });

  it('promo kód jen na kategorie / zóny; cizí kód neplatí', async () => {
    const mk = (body: Record<string, unknown>) => admin('POST', '/api/admin/promo-codes', () => import('@/app/api/admin/promo-codes/route'), body);
    expect((await mk({ code: `PLNE10${randomUUID().slice(0, 4)}`.toUpperCase(), type: 'percentage', discountValue: 10, applicableCategoryCodes: ['plne'] })).status).toBe(201);
    const zoneCode = `ZONAA${randomUUID().slice(0, 4)}`.toUpperCase();
    expect((await mk({ code: zoneCode, type: 'percentage', discountValue: 20, applicableTicketTypeIds: [c.ticketTypeId] })).status).toBe(201);
    const r = await buy([{ seatId: seat.B5, categoryId: cat.plne }], { promoCode: zoneCode });
    expect(r.status).toBe(422);
    expect(r.json.error).toBe('PROMO_CODE_NOT_APPLICABLE');
    // kód jiného pořadatele
    const other = await clone.seed.chain();
    const foreign = `CIZI${randomUUID().slice(0, 4)}`.toUpperCase();
    await clone.pool.query(`INSERT INTO marketing.promo_codes (code, type, discount_value, created_by_organizer_id, active) VALUES ($1,'percentage',50,$2,true)`, [foreign, other.promoterId]);
    const f = await buy([{ seatId: seat.B4, categoryId: cat.plne }], { promoCode: foreign });
    expect(f.status).toBe(422);
    expect(f.json.error).toBe('PROMO_CODE_INVALID');
  });

  it('nákup míst s kategoriemi: cena na serveru, promo −10 % jen na plné, vstupenky, e-mail, PDF a skener', async () => {
    const code = `PLNEX${randomUUID().slice(0, 4)}`.toUpperCase();
    await admin('POST', '/api/admin/promo-codes', () => import('@/app/api/admin/promo-codes/route'),
      { code, type: 'percentage', discountValue: 10, applicableCategoryCodes: ['plne'] });
    const r = await buy([
      { seatId: seat.A1, categoryId: cat.plne, priceMinor: 1 }, // podstrčená cena se ignoruje
      { seatId: seat.A2, categoryId: cat.ztpp },
      { seatId: seat.A3, categoryId: cat['doprovod-ztpp'] },
      { seatId: seat.B1, categoryId: cat.senior },
      { seatId: seat.B2, categoryId: cat.student },
      { seatId: seat.B3, categoryId: cat.plne },
    ], { promoCode: code });
    expect(r.status, r.text).toBe(200);
    // 50000−5000 + 25000 + 0 + 20000 + 21000 + 30000−3000
    expect(r.json.totalAmount).toBe(138000);
    const items = (await clone.pool.query(
      `SELECT es.seat_number, es.row, oi.unit_price, oi.price_category_name FROM orders.order_items oi JOIN catalog.event_seats es ON es.id = oi.seat_id
        WHERE oi.order_id=$1 ORDER BY es.row, es.seat_number::int`, [r.json.orderId])).rows;
    expect(items.map((i) => [`${i.row}${i.seat_number}`, i.unit_price, i.price_category_name])).toEqual([
      ['A1', 45000, 'Plné'], ['A2', 25000, 'ZTP/P'], ['A3', 0, 'Doprovod ZTP/P'], ['B1', 20000, 'Senior'], ['B2', 21000, 'Student'], ['B3', 27000, 'Plné'],
    ]);

    // zaplacení u brány (simulátor) → webhook → vstupenky + e-mail s PDF
    await realFetch(`${FAKE}/_ctl/${String(r.json.paymentId)}`, { method: 'POST', body: JSON.stringify({ state: 'PAID' }) });
    const { GET: webhook } = await import('@/app/api/payments/gopay/webhook/route');
    const wh = await (webhook as unknown as H)(new Request(`http://localhost/api/payments/gopay/webhook?id=${String(r.json.paymentId)}`) as unknown as NextRequest);
    expect(wh.status, await wh.clone().text()).toBe(200);
    let tickets: Array<{ id: string; seat_number: string; row: string; price_category_name: string; proof_required_label: string | null; totp_secret_encrypted: Buffer }> = [];
    for (let i = 0; i < 60 && tickets.length < 6; i++) {
      tickets = (await clone.pool.query(
        `SELECT t.id, es.seat_number, es.row, t.price_category_name, t.proof_required_label, t.totp_secret_encrypted
           FROM tickets.tickets t JOIN catalog.event_seats es ON es.id = t.event_seat_id WHERE t.order_id=$1 ORDER BY es.row, es.seat_number::int`, [r.json.orderId])).rows;
      if (tickets.length < 6) await new Promise((res) => setTimeout(res, 250));
    }
    expect(tickets.map((t) => [`${t.row}${t.seat_number}`, t.price_category_name, t.proof_required_label])).toEqual([
      ['A1', 'Plné', null], ['A2', 'ZTP/P', 'ZTP/P'], ['A3', 'Doprovod ZTP/P', null], ['B1', 'Senior', 'Senior (věk)'], ['B2', 'Student', 'Student (ISIC)'], ['B3', 'Plné', null],
    ]);

    // e-mail: kategorie a místa v položkách; PDF příloha s kategorií
    let mail: Awaited<ReturnType<typeof mailpitLatest>> = null;
    for (let i = 0; i < 40 && !mail; i++) { mail = await mailpitLatest(r.email); if (!mail) await new Promise((res) => setTimeout(res, 250)); }
    expect(mail?.html).toContain('Zóna A — ZTP/P');
    expect(mail?.html).toContain('Přízemí, řada A, místo 2');
    const msg = await (await realFetch(`${MAILPIT}/api/v1/message/${mail!.id}`)).json() as { Attachments: Array<{ PartID: string; FileName: string }> };
    const pdfPart = msg.Attachments.find((a) => a.FileName.endsWith('.pdf'))!;
    const pdfBuf = new Uint8Array(await (await realFetch(`${MAILPIT}/api/v1/message/${mail!.id}/part/${pdfPart.PartID}`)).arrayBuffer());
    const text = pdfText(pdfBuf);
    expect(text).toContain('Kategorie: ZTP/P');
    expect(text).toContain('Při vstupu předložte průkaz: ZTP/P');

    // skener: ZTP/P → výrazně „Ověřit průkaz: ZTP/P", místo; plné bez výzvy
    const { decryptSecret } = await import('@/lib/crypto');
    const { generateTotpCode } = await import('@/lib/totp/verify');
    const { POST: scan } = await import('@/app/api/admin/scanner/validate/route');
    const doScan = async (t: (typeof tickets)[number]) => {
      const raw = Buffer.from(decryptSecret(t.totp_secret_encrypted.toString('base64')), 'base64');
      const res = await throughMiddleware(new Request('http://localhost/api/admin/scanner/validate', {
        method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost', authorization: `Bearer ${tok}` },
        body: JSON.stringify({ ticketId: t.id, totpCode: generateTotpCode(raw), eventId: c.eventId }),
      }), scan as unknown as H);
      return res.json() as Promise<{ result: string; ticket: { verifyId: string | null; seat: string | null; category: string | null } }>;
    };
    const z = await doScan(tickets[1]);
    expect(z.result).toBe('admitted');
    expect(z.ticket).toMatchObject({ verifyId: 'Ověřit průkaz: ZTP/P', seat: 'Přízemí, řada A, místo 2', category: 'ZTP/P' });
    const f = await doScan(tickets[0]);
    expect(f.ticket.verifyId).toBeNull();
  }, 60_000);
});
