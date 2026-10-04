// @vitest-environment node
/**
 * Kolo 8 / krok 6 — firemní / skupinové objednávky na fakturu.
 *
 * Očekávané:
 *   - firma podle IČO z ARES (název, sídlo, DIČ; výpadek ARES = ruční vyplnění), kontakt;
 *   - místa z volného prodeje nebo z blokace, kategorie, cena upravitelná jen s důvodem, splatnost;
 *   - daňový doklad po sazbách typů vstupenek, ISDOC, e-mail kontaktu (PDF + ISDOC);
 *   - místa držená do zaplacení (cron expirace je nebere); zaplaceno (datum + reference) → vstupenky kontaktu
 *     jedním PDF i každá zvlášť;
 *   - po splatnosti upozornění pořadateli (jednou), místa zůstávají; zrušení = dobropis + místa zpět (do blokace).
 */
import { randomUUID } from 'crypto';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import type { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx?: unknown) => Promise<Response>;
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:58225';

run('Kolo 8 — firemní objednávky na fakturu', () => {
  let clone: LocalClone;
  let c: Awaited<ReturnType<LocalClone['seed']['chain']>>;
  let tok: string;
  let ttB = '';
  let blockId = '';
  let ares: Server;
  const prevAres = process.env.ARES_BASE_URL;
  const A: string[] = [];
  const B: string[] = [];
  const cat: Record<string, string> = {};
  const realFetch = globalThis.fetch;

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
  const corp = () => import('@/app/api/admin/corporate-orders/route');
  const company = { name: 'Firma XY s.r.o.', ico: '27082440', dic: 'CZ27082440', address: 'Václavské náměstí 1, 110 00 Praha 1' };
  const mails = async (to: string, subjectPart: string) => {
    for (let i = 0; i < 40; i++) {
      const j = await (await realFetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent('to:' + to)}&limit=20`)).json() as { messages?: Array<{ ID: string; Subject: string }> };
      const hit = j.messages?.find((m) => m.Subject.includes(subjectPart));
      if (hit) {
        const mj = await (await realFetch(`${MAILPIT}/api/v1/message/${hit.ID}`)).json() as { HTML?: string; Attachments: Array<{ FileName: string; PartID: string }> };
        return { id: hit.ID, subject: hit.Subject, html: mj.HTML ?? '', attachments: mj.Attachments ?? [], count: j.messages!.filter((m) => m.Subject.includes(subjectPart)).length };
      }
      await new Promise((res) => setTimeout(res, 250));
    }
    throw new Error(`mail „${subjectPart}" pro ${to} nedorazil`);
  };
  async function cronOverdue() {
    const { GET: dispatch } = await import('@/app/api/cron/dispatch/route');
    const { POST: job } = await import('@/app/api/internal/cron/corporate-orders-overdue/route');
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (u.pathname === '/api/internal/cron/corporate-orders-overdue') return throughMiddleware(new Request(`http://localhost${u.pathname}`, init), job as H);
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      const r = await throughMiddleware(new Request('http://localhost/api/cron/dispatch?job=corporate-orders-overdue', {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      }), dispatch as H);
      const body = (await r.json()) as { status: number; result: { overdue: number; mailed: number } };
      expect(body.status, JSON.stringify(body)).toBe(200);
      return body.result;
    } finally { globalThis.fetch = realFetch; }
  }

  beforeAll(async () => {
    // lokální ARES (testy nesmí ven z localhostu)
    ares = createServer((req, res) => {
      const ico = (req.url ?? '').split('/').pop();
      if (ico === '27082440') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ico, obchodniJmeno: 'Firma XY s.r.o.', dic: 'CZ27082440', sidlo: { textovaAdresa: 'Václavské náměstí 1, 110 00 Praha 1' }, datumVzniku: '2004-01-01' }));
      } else if (ico === '00000019') { res.writeHead(500); res.end(); } else { res.writeHead(404); res.end(); }
    });
    await new Promise<void>((r) => ares.listen(0, '127.0.0.1', r));
    process.env.ARES_BASE_URL = `http://127.0.0.1:${(ares.address() as AddressInfo).port}`;

    clone = await createLocalClone();
    c = await clone.seed.chain({ totalQty: 20, remainingQty: 20, basePrice: 50000 });
    await clone.pool.query(`UPDATE catalog.ticket_types SET is_seated = true, zone = 'Přízemí', name = 'Přízemí' WHERE id=$1`, [c.ticketTypeId]);
    ttB = (await clone.pool.query<{ id: string }>(
      `INSERT INTO catalog.ticket_types (event_id, name, kind, base_price, total_qty, remaining_qty, visibility, vat_rate_code, zone, is_seated)
       VALUES ($1,'Balkon + raut','standing',30000,20,20,'public','CZ_STANDARD','Balkon', true) RETURNING id`, [c.eventId])).rows[0].id;
    for (const [arr, tt, sector] of [[A, c.ticketTypeId, 'Přízemí'], [B, ttB, 'Balkon']] as const) {
      for (let n = 1; n <= 20; n++) {
        arr.push((await clone.pool.query<{ id: string }>(
          `INSERT INTO catalog.event_seats (event_id, ticket_type_id, sector, row, seat_number, x_coord, y_coord, status)
           VALUES ($1,$2,$3,$4,$5,$6,10,'available') RETURNING id`, [c.eventId, tt, sector, String(Math.ceil(n / 10)), String(((n - 1) % 10) + 1), n * 20])).rows[0].id);
      }
    }
    const { signAccessToken } = await import('@/lib/auth');
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [c.adminUserId])).rows[0].email;
    tok = await signAccessToken({ id: c.adminUserId, email, name: 'U' } as never, {
      isPlatformAdmin: false, promoterMemberships: [{ promoterId: c.promoterId, slug: 'x', name: 'x', status: 'active', role: 'owner' }],
    } as never);
    await clone.pool.query(`UPDATE platform.promoters SET company_ico = '12345678', company_address = 'Celetná 17, 110 00 Praha 1', bank_account = '123456789/0100' WHERE id = $1`, [c.promoterId]);
    const t = await call('POST', `/api/admin/events/${c.eventId}/categories`, () => import('@/app/api/admin/events/[id]/categories/route'), { applyTemplate: true }, { params: { id: c.eventId } });
    for (const x of t.json.categories as Array<{ id: string; code: string }>) cat[x.code] = x.id;
    // blokace „Firma XY" 20 míst: A1–A10 + B1–B10
    const b = await call('POST', `/api/admin/events/${c.eventId}/blocks`, () => import('@/app/api/admin/events/[id]/blocks/route'),
      { name: 'Firma XY', seatIds: [...A.slice(0, 10), ...B.slice(0, 10)] }, { params: { id: c.eventId } });
    expect(b.status, b.text).toBe(201);
    blockId = (b.json.block as { id: string }).id;
  }, 120_000);
  afterAll(async () => {
    globalThis.fetch = realFetch;
    if (prevAres === undefined) delete process.env.ARES_BASE_URL; else process.env.ARES_BASE_URL = prevAres;
    await new Promise((r) => ares?.close(r));
    await clone?.cleanup();
  }, 60_000);

  it('ARES: údaje firmy podle IČO; neznámé IČO 404; výpadek 503 (vyplnit ručně)', async () => {
    const ok = await call('GET', '/api/admin/ares/27082440', () => import('@/app/api/admin/ares/[ico]/route'), undefined, { params: { ico: '27082440' } });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.json).toMatchObject({ name: company.name, dic: company.dic, address: company.address, active: true });
    expect((await call('GET', '/api/admin/ares/12345679', () => import('@/app/api/admin/ares/[ico]/route'), undefined, { params: { ico: '12345679' } })).status).toBe(404);
    expect((await call('GET', '/api/admin/ares/00000019', () => import('@/app/api/admin/ares/[ico]/route'), undefined, { params: { ico: '00000019' } })).status).toBe(503);
  });

  let corpId = '';
  let corpOrderId = '';
  const contact = `nakup-${randomUUID().slice(0, 6)}@firma-xy.test`;
  const due = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);

  it('z blokace 15 míst: upravená cena bez důvodu neprojde; doklad po sazbách, ISDOC, e-mail; místa držená, vstupenky zatím ne', async () => {
    const seats = [...A.slice(0, 10), ...B.slice(0, 5)].map((seatId, i) => ({ seatId, categoryId: cat.plne, ...(i >= 10 ? { priceMinor: 25000 } : {}) }));
    const body = { eventId: c.eventId, company, contact: { name: 'Jan Nákupčí', email: contact }, blockId, seats, dueDate: due };
    const noReason = await call('POST', '/api/admin/corporate-orders', corp, body);
    expect(noReason.status).toBe(422);
    expect(noReason.json.error).toBe('PRICE_REASON_REQUIRED');
    const r = await call('POST', '/api/admin/corporate-orders', corp, { ...body, priceOverrideReason: 'Skupinová sleva balkon' });
    expect(r.status, r.text).toBe(201);
    expect(r.json.totalMinor).toBe(10 * 50000 + 5 * 25000);
    corpId = r.json.id as string;
    corpOrderId = r.json.orderId as string;

    const inv = (await clone.pool.query(
      `SELECT i.invoice_number, i.total_minor::int AS total_minor, i.paid_at, i.customer_ico, i.customer_dic, i.due_date::text AS due,
              (SELECT json_agg(json_build_object('code', l.vat_rate_code, 'total', l.total_minor) ORDER BY l.vat_rate_code) FROM orders.invoice_vat_lines l WHERE l.invoice_id = i.id) AS lines
         FROM orders.invoices i WHERE i.id = $1`, [r.json.invoiceId])).rows[0];
    expect(inv).toMatchObject({ total_minor: 625000, paid_at: null, customer_ico: '27082440', customer_dic: 'CZ27082440', due });
    expect(inv.lines).toEqual([{ code: 'CZ_REDUCED', total: 500000 }, { code: 'CZ_STANDARD', total: 125000 }]);

    const io = (await clone.pool.query(`SELECT status, block_id, price_override_reason, company_dic FROM b2b_orders.invoice_orders WHERE id=$1`, [corpId])).rows[0];
    expect(io).toEqual({ status: 'confirmed', block_id: blockId, price_override_reason: 'Skupinová sleva balkon', company_dic: 'CZ27082440' });
    const m = await mails(contact, String(inv.invoice_number));
    expect(m.attachments.map((a) => a.FileName).sort()).toEqual([`faktura-${String(inv.invoice_number)}.isdoc`, `faktura-${String(inv.invoice_number)}.pdf`]);
    const isdocPart = m.attachments.find((a) => a.FileName.endsWith('.isdoc'))!;
    const xml = await (await realFetch(`${MAILPIT}/api/v1/message/${m.id}/part/${isdocPart.PartID}`)).text();
    expect(xml).toContain('<Invoice');
    expect(xml).toContain('27082440');

    // místa: prodaná na objednávku, v blokaci jako firemní; vstupenky zatím nejsou
    const st = (await clone.pool.query(`SELECT COUNT(*) FILTER (WHERE status='sold' AND order_id=$2)::int AS n FROM catalog.event_seats WHERE event_id=$1`, [c.eventId, corpOrderId])).rows[0].n;
    expect(st).toBe(15);
    const ov = await call('GET', `/api/admin/events/${c.eventId}/blocks`, () => import('@/app/api/admin/events/[id]/blocks/route'), undefined, { params: { id: c.eventId } });
    expect((ov.json.blocks as Array<{ name: string; sold: number; blocked: number }>)[0]).toMatchObject({ name: 'Firma XY', sold: 15, blocked: 5 });
    expect((await clone.pool.query(`SELECT COUNT(*)::int AS n FROM tickets.tickets WHERE order_id=$1`, [corpOrderId])).rows[0].n).toBe(0);

    // cron expirace nezaplacených objednávek ji nechá být
    await clone.pool.query(`UPDATE orders.orders SET expires_at = now() - interval '1 minute' WHERE id=$1`, [corpOrderId]);
    const { POST: expirePending } = await import('@/app/api/internal/cron/expire-pending-orders/route');
    await (expirePending as unknown as H)(new Request('http://localhost/x', { method: 'POST', headers: { 'x-internal-token': process.env.INTERNAL_SERVICE_TOKEN ?? '' } }) as unknown as NextRequest);
    expect((await clone.pool.query(`SELECT status FROM orders.orders WHERE id=$1`, [corpOrderId])).rows[0].status).toBe('pending');
  });

  it('zaplaceno (datum + reference) → vstupenky kontaktu: společné PDF i každá zvlášť; doklad zaplacen', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const p = await call('POST', `/api/admin/corporate-orders/${corpId}/paid`, () => import('@/app/api/admin/corporate-orders/[id]/paid/route'),
      { paidOn: today, paymentReference: 'VS 2026001' }, { params: { id: corpId } });
    expect(p.status, p.text).toBe(200);
    expect(p.json.tickets).toBe(15);
    expect(p.json.ticketsEmailed).toBe(true);
    const st = (await clone.pool.query(
      `SELECT o.status, io.status AS io_status, io.payment_reference, (i.paid_at IS NOT NULL) AS inv_paid
         FROM b2b_orders.invoice_orders io JOIN orders.orders o ON o.id = io.order_id JOIN orders.invoices i ON i.id = io.invoice_id WHERE io.id=$1`, [corpId])).rows[0];
    expect(st).toEqual({ status: 'paid', io_status: 'paid', payment_reference: 'VS 2026001', inv_paid: true });
    const m = await mails(contact, 'vstupenky');
    const pdfs = m.attachments.filter((a) => a.FileName.endsWith('.pdf')).map((a) => a.FileName);
    expect(pdfs).toHaveLength(16);
    expect(pdfs.filter((f) => f.startsWith('vstupenky-'))).toHaveLength(1);
    const again = await call('POST', `/api/admin/corporate-orders/${corpId}/paid`, () => import('@/app/api/admin/corporate-orders/[id]/paid/route'),
      { paidOn: today, paymentReference: 'x' }, { params: { id: corpId } });
    expect(again.status).toBe(409);
  });

  it('po splatnosti: upozornění pořadateli jednou, místa zůstávají držená; ruční uvolnění = dobropis + místa do prodeje', async () => {
    const r = await call('POST', '/api/admin/corporate-orders', corp, {
      eventId: c.eventId, company, contact: { name: 'Jan Nákupčí', email: contact }, seats: A.slice(15, 18).map((seatId) => ({ seatId, categoryId: cat.senior })), dueDate: due,
    });
    expect(r.status, r.text).toBe(201);
    const remainingBefore = (await clone.pool.query(`SELECT remaining_qty FROM catalog.ticket_types WHERE id=$1`, [c.ticketTypeId])).rows[0].remaining_qty;
    await clone.pool.query(`UPDATE b2b_orders.invoice_orders SET due_date = CURRENT_DATE - 1 WHERE id=$1`, [r.json.id]);
    const res = await cronOverdue();
    expect(res.overdue).toBeGreaterThanOrEqual(1);
    const promoterMail = (await clone.pool.query(`SELECT COALESCE(contact_email, email) AS e FROM platform.promoters WHERE id=$1`, [c.promoterId])).rows[0].e;
    const m = await mails(promoterMail, 'po splatnosti');
    expect(m.html).toContain('Firma XY');
    expect((await cronOverdue()).overdue).toBe(0);
    expect((await clone.pool.query(`SELECT status FROM b2b_orders.invoice_orders WHERE id=$1`, [r.json.id])).rows[0].status).toBe('overdue');
    expect((await clone.pool.query(`SELECT COUNT(*)::int AS n FROM catalog.event_seats WHERE order_id=$1 AND status='sold'`, [r.json.orderId])).rows[0].n).toBe(3);

    const cn = await call('POST', `/api/admin/corporate-orders/${String(r.json.id)}/cancel`, () => import('@/app/api/admin/corporate-orders/[id]/cancel/route'),
      { reason: 'Nezaplaceno — uvolnění míst' }, { params: { id: r.json.id } });
    expect(cn.status, cn.text).toBe(200);
    expect(cn.json.seatsReturned).toBe(3);
    const note = (await clone.pool.query(`SELECT doc_type, total_minor::int AS total_minor, corrects_invoice_id FROM orders.invoices WHERE id=$1`, [cn.json.creditNoteId])).rows[0];
    expect(note).toEqual({ doc_type: 'credit_note', total_minor: -120000, corrects_invoice_id: r.json.invoiceId });
    expect((await clone.pool.query(`SELECT COUNT(*)::int AS n FROM catalog.event_seats WHERE id = ANY($1::uuid[]) AND status='available' AND order_id IS NULL`, [A.slice(15, 18)])).rows[0].n).toBe(3);
    expect((await clone.pool.query(`SELECT remaining_qty FROM catalog.ticket_types WHERE id=$1`, [c.ticketTypeId])).rows[0].remaining_qty).toBe(remainingBefore + 3);
  });

  it('zrušení zaplacené objednávky z blokace: dobropis, vstupenky zneplatněné, místa zpět do blokace', async () => {
    const r = await call('POST', '/api/admin/corporate-orders', corp, {
      eventId: c.eventId, company, contact: { name: 'Jan Nákupčí', email: contact }, blockId, seats: B.slice(5, 7).map((seatId) => ({ seatId, categoryId: cat.plne })), dueDate: due,
    });
    expect(r.status, r.text).toBe(201);
    const id = String(r.json.id);
    await call('POST', `/api/admin/corporate-orders/${id}/paid`, () => import('@/app/api/admin/corporate-orders/[id]/paid/route'),
      { paidOn: new Date().toISOString().slice(0, 10), paymentReference: 'VS 2' }, { params: { id } });
    const cn = await call('POST', `/api/admin/corporate-orders/${id}/cancel`, () => import('@/app/api/admin/corporate-orders/[id]/cancel/route'), { reason: 'Firma akci zrušila' }, { params: { id } });
    expect(cn.status, cn.text).toBe(200);
    expect((await clone.pool.query(`SELECT array_agg(DISTINCT status) AS s FROM tickets.tickets WHERE order_id=$1`, [r.json.orderId])).rows[0].s).toEqual(['revoked']);
    const back = (await clone.pool.query(
      `SELECT es.status, es.hold_label, bs.state FROM catalog.event_seats es JOIN catalog.seat_block_seats bs ON bs.seat_id = es.id AND bs.block_id = $2
        WHERE es.id = ANY($1::uuid[])`, [B.slice(5, 7), blockId])).rows;
    expect(back).toEqual([{ status: 'blocked', hold_label: 'Firma XY', state: 'blocked' }, { status: 'blocked', hold_label: 'Firma XY', state: 'blocked' }]);
    expect((await clone.pool.query(`SELECT COUNT(*)::int AS n FROM orders.invoices WHERE order_id=$1 AND doc_type='credit_note'`, [r.json.orderId])).rows[0].n).toBe(1);
  });

  it('cizí pořadatel firemní objednávku nevidí ani neoznačí', async () => {
    const other = await clone.seed.chain();
    const { signAccessToken } = await import('@/lib/auth');
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [other.adminUserId])).rows[0].email;
    const t2 = await signAccessToken({ id: other.adminUserId, email, name: 'O' } as never, {
      isPlatformAdmin: false, promoterMemberships: [{ promoterId: other.promoterId, slug: 'o', name: 'o', status: 'active', role: 'owner' }],
    } as never);
    const list = await call('GET', `/api/admin/corporate-orders?eventId=${c.eventId}`, corp, undefined, {}, t2);
    expect(list.json.orders).toEqual([]);
    const p = await call('POST', `/api/admin/corporate-orders/${corpId}/cancel`, () => import('@/app/api/admin/corporate-orders/[id]/cancel/route'), { reason: 'x' }, { params: { id: corpId } }, t2);
    expect(p.status).toBe(404);
  });
});
