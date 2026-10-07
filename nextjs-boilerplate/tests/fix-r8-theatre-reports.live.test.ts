// @vitest-environment node
/**
 * Kolo 8 / krok 8 — reporty za termín, inscenaci a období + seznam pro uvaděče.
 *
 * Očekávané:
 *   - prodáno a tržby podle zóny, kategorie a kanálu (online, pokladna, rezervace, firemní, volné);
 *   - obsazenost sálu v %, využití blokací, propadlé rezervace;
 *   - export CSV a XLSX; seznam pro uvaděče (sál, řada, místo, kategorie, jméno, ověřit průkaz) jako JSON / CSV / PDF;
 *   - cizí pořadatel nevidí nic.
 */
import { randomUUID } from 'crypto';
import { strFromU8, unzipSync } from 'fflate';
import type { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { pdfText } from './helpers/pdf-text';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx?: unknown) => Promise<Response>;
const FAKE = process.env.FIX_GOPAY_URL ?? 'http://localhost:3998';

run('Kolo 8 — divadelní reporty', () => {
  let clone: LocalClone;
  let p: Awaited<ReturnType<LocalClone['seed']['chain']>>;
  let tok: string;
  let productionId = '';
  const realFetch = globalThis.fetch;
  interface Term { eventId: string; ttA: string; ttB: string; A: string[]; B: string[]; cat: Record<string, string> }
  let t1: Term;
  let t2: Term;

  const call = async (method: string, url: string, mod: () => Promise<Record<string, unknown>>, body?: unknown, ctx: unknown = {}, token = tok) => {
    const m = await mod();
    const r = await throughMiddleware(new Request(`http://localhost${url}`, {
      method, headers: { 'content-type': 'application/json', origin: 'http://localhost', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), m[method] as H, ctx);
    return r;
  };
  const json = async (r: Response) => JSON.parse(await r.text()) as Record<string, unknown>;
  const ip = () => `198.51.180.${Math.floor(Math.random() * 250) + 1}`;

  async function term(day: number): Promise<Term> {
    const eventId = randomUUID();
    await clone.pool.query(
      `INSERT INTO catalog.events (id, organizer_id, promoter_id, venue_id, title, slug, status, currency, event_type, date_start, production_id)
       VALUES ($1,$2,$2,$3,'Racek',$4,'published','CZK','theatre', date_trunc('day', now()) + ($5 || ' days')::interval + interval '19 hours', $6)`,
      [eventId, p.promoterId, p.venueId, `racek-${eventId.slice(0, 8)}`, String(day), productionId]);
    const tt = async (name: string, price: number) => (await clone.pool.query<{ id: string }>(
      `INSERT INTO catalog.ticket_types (event_id, name, kind, base_price, total_qty, remaining_qty, visibility, vat_rate_code, zone, is_seated)
       VALUES ($1,$2,'standing',$3,10,10,'public','CZ_REDUCED',$2,true) RETURNING id`, [eventId, name, price])).rows[0].id;
    const ttA = await tt('Přízemí', 50000);
    const ttB = await tt('Balkon', 30000);
    const seats = async (ttId: string, sector: string) => {
      const out: string[] = [];
      for (let n = 1; n <= 10; n++) {
        out.push((await clone.pool.query<{ id: string }>(
          `INSERT INTO catalog.event_seats (event_id, ticket_type_id, sector, row, seat_number, x_coord, y_coord, status)
           VALUES ($1,$2,$3,'1',$4,$5,10,'available') RETURNING id`, [eventId, ttId, sector, String(n), n * 20])).rows[0].id);
      }
      return out;
    };
    const A = await seats(ttA, 'Přízemí');
    const B = await seats(ttB, 'Balkon');
    const c = await json(await call('POST', `/api/admin/events/${eventId}/categories`, () => import('@/app/api/admin/events/[id]/categories/route'), { applyTemplate: true }, { params: { id: eventId } }));
    const cat: Record<string, string> = {};
    for (const x of c.categories as Array<{ id: string; code: string }>) cat[x.code] = x.id;
    return { eventId, ttA, ttB, A, B, cat };
  }
  async function checkout(t: Term, items: Array<[string, string]>, extra: Record<string, unknown> = {}) {
    const { POST: holdR } = await import('@/app/api/events/[id]/seats/hold/route');
    const h = await (holdR as unknown as H)(new Request(`http://localhost/api/events/${t.eventId}/seats/hold`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip() }, body: JSON.stringify({ seatIds: items.map((i) => i[0]) }),
    }) as unknown as NextRequest, { params: { id: t.eventId } });
    const token = ((await h.json()) as { holdToken: string }).holdToken;
    const { POST } = await import('@/app/api/checkout/seats/route');
    const r = await (POST as unknown as H)(new Request('http://localhost/api/checkout/seats', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip() },
      body: JSON.stringify({ eventId: t.eventId, seatHoldToken: token, items: items.map(([seatId, code]) => ({ seatId, categoryId: t.cat[code] })),
        buyerEmail: `rep-${randomUUID().slice(0, 6)}@tixly.test`, buyerName: 'Eva Divačka', ...extra }),
    }) as unknown as NextRequest);
    const j = await r.json() as { orderId: string; paymentId?: string; reservationCode?: string };
    expect(r.status, JSON.stringify(j)).toBe(200);
    return j;
  }
  async function payOnline(paymentId: string, orderId: string, n: number) {
    await realFetch(`${FAKE}/_ctl/${paymentId}`, { method: 'POST', body: JSON.stringify({ state: 'PAID' }) });
    const { GET: webhook } = await import('@/app/api/payments/gopay/webhook/route');
    await (webhook as unknown as H)(new Request(`http://localhost/api/payments/gopay/webhook?id=${paymentId}`) as unknown as NextRequest);
    for (let i = 0; i < 40; i++) {
      if ((await clone.pool.query(`SELECT COUNT(*)::int AS n FROM tickets.tickets WHERE order_id=$1`, [orderId])).rows[0].n >= n) return;
      await new Promise((res) => setTimeout(res, 250));
    }
  }

  beforeAll(async () => {
    clone = await createLocalClone();
    p = await clone.seed.chain();
    await clone.pool.query(`UPDATE platform.promoters SET company_ico = '12345678', company_address = 'Celetná 17, 110 00 Praha 1' WHERE id = $1`, [p.promoterId]);
    const { signAccessToken } = await import('@/lib/auth');
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [p.adminUserId])).rows[0].email;
    tok = await signAccessToken({ id: p.adminUserId, email, name: 'U' } as never, {
      isPlatformAdmin: false, promoterMemberships: [{ promoterId: p.promoterId, slug: 'x', name: 'x', status: 'active', role: 'owner' }],
    } as never);
    productionId = (await clone.pool.query<{ id: string }>(
      `INSERT INTO catalog.productions (promoter_id, title) VALUES ($1, 'Racek') RETURNING id`, [p.promoterId])).rows[0].id;
    t1 = await term(10);
    t2 = await term(12);

    // online: A1 plné, A2 ZTP/P, A3 doprovod, B1 senior
    const o = await checkout(t1, [[t1.A[0], 'plne'], [t1.A[1], 'ztpp'], [t1.A[2], 'doprovod-ztpp'], [t1.B[0], 'senior']]);
    await payOnline(o.paymentId!, o.orderId, 4);
    // pokladna: A4 hotově
    expect((await call('POST', '/api/admin/pos/sale', () => import('@/app/api/admin/pos/sale/route'),
      { eventId: t1.eventId, ticketTypeId: t1.ttA, quantity: 1, seatIds: [t1.A[3]], paymentMethod: 'cash' })).status).toBe(200);
    // rezervace: A5 student zaplacená kartou, A6 aktivní, A7 propadlá
    await call('PATCH', `/api/admin/events/${t1.eventId}/reservations`, () => import('@/app/api/admin/events/[id]/reservations/route'), { enabled: true }, { params: { id: t1.eventId } });
    const r1 = await checkout(t1, [[t1.A[4], 'student']], { paymentMethod: 'box_office_reservation' });
    const r1id = (await clone.pool.query(`SELECT id FROM orders.seat_reservations WHERE order_id=$1`, [r1.orderId])).rows[0].id as string;
    expect((await call('POST', `/api/admin/seat-reservations/${r1id}/pay`, () => import('@/app/api/admin/seat-reservations/[id]/pay/route'), { paymentType: 'card' }, { params: { id: r1id } })).status).toBe(200);
    await checkout(t1, [[t1.A[5], 'plne']], { paymentMethod: 'box_office_reservation' });
    const r3 = await checkout(t1, [[t1.A[6], 'plne']], { paymentMethod: 'box_office_reservation' });
    await clone.pool.query(`UPDATE orders.seat_reservations SET expires_at = now() - interval '1 minute' WHERE order_id=$1`, [r3.orderId]);
    const { POST: cron } = await import('@/app/api/internal/cron/seat-reservations/route');
    await (cron as unknown as H)(new Request('http://localhost/x', { method: 'POST', headers: { 'x-internal-token': process.env.INTERNAL_SERVICE_TOKEN ?? '' } }) as unknown as NextRequest);
    // blokace Firma XY (B2, B3) → firemní objednávka zaplacená; Tisk (B4–B7) → 1 volná na jméno, 1 uvolněná
    const blk = async (name: string, seatIds: string[]) => ((await json(await call('POST', `/api/admin/events/${t1.eventId}/blocks`, () => import('@/app/api/admin/events/[id]/blocks/route'),
      { name, seatIds }, { params: { id: t1.eventId } }))).block as { id: string }).id;
    const firma = await blk('Firma XY', [t1.B[1], t1.B[2]]);
    const tisk = await blk('Tisk', [t1.B[3], t1.B[4], t1.B[5], t1.B[6]]);
    const corp = await json(await call('POST', '/api/admin/corporate-orders', () => import('@/app/api/admin/corporate-orders/route'), {
      eventId: t1.eventId, blockId: firma, company: { name: 'Firma XY s.r.o.', ico: '27082440', address: 'Praha 1' }, contact: { name: 'Jan', email: 'jan@firma-xy.test' },
      seats: [t1.B[1], t1.B[2]].map((seatId) => ({ seatId, categoryId: t1.cat.plne })), dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
    }));
    await call('POST', `/api/admin/corporate-orders/${String(corp.id)}/paid`, () => import('@/app/api/admin/corporate-orders/[id]/paid/route'),
      { paidOn: new Date().toISOString().slice(0, 10), paymentReference: 'VS9' }, { params: { id: corp.id } });
    expect((await call('POST', `/api/admin/events/${t1.eventId}/blocks/${tisk}/comps`, () => import('@/app/api/admin/events/[id]/blocks/[blockId]/comps/route'),
      { seats: [{ seatId: t1.B[3], holderName: 'Novinář Jan' }] }, { params: { id: t1.eventId, blockId: tisk } })).status).toBe(201);
    expect((await call('POST', `/api/admin/events/${t1.eventId}/blocks/${tisk}/release`, () => import('@/app/api/admin/events/[id]/blocks/[blockId]/release/route'),
      { seatIds: [t1.B[4]] }, { params: { id: t1.eventId, blockId: tisk } })).status).toBe(200);
    // termín 2: online 1× plné
    const o2 = await checkout(t2, [[t2.A[0], 'plne']]);
    await payOnline(o2.paymentId!, o2.orderId, 1);
  }, 180_000);
  afterAll(async () => { globalThis.fetch = realFetch; await clone?.cleanup(); }, 60_000);

  const report = (q: string) => call('GET', `/api/admin/theatre-reports?${q}`, () => import('@/app/api/admin/theatre-reports/route'));

  it('termín: prodej po zóně × kategorii × kanálu, obsazenost, blokace, rezervace', async () => {
    const r = await json(await report(`scope=term&eventId=${t1.eventId}`));
    const sales = (r.sales as Array<{ zone: string; category: string; channel: string; sold: number; revenueMinor: number }>)
      .map((s) => `${s.zone}|${s.category}|${s.channel}|${s.sold}|${s.revenueMinor}`).sort();
    expect(sales).toEqual([
      'Balkon|Plné|comps|1|0',
      'Balkon|Plné|corporate|2|60000',
      'Balkon|Senior|online|1|24000',
      'Přízemí|Doprovod ZTP/P|online|1|0',
      'Přízemí|Plné|box_office|1|50000',
      'Přízemí|Plné|online|1|50000',
      'Přízemí|Student|reservation|1|35000',
      'Přízemí|ZTP/P|online|1|25000',
    ].sort());
    expect(r.totals).toEqual({ sold: 9, revenueMinor: 244000, offlineDuplicates: 0 } /* kolo 14: + duplicitní offline vstupy */);
    expect(r.productionId).toBe(productionId);
    expect(r.occupancy).toEqual([expect.objectContaining({ sellable: 20, sold: 9, reserved: 1, blocked: 2, occupiedPct: 50, hall: 'Test Sál', city: 'Praha' })]);
    expect((r.blocks as Array<Record<string, unknown>>).map((b) => [b.block, b.total, b.released, b.issued, b.sold, b.remaining])).toEqual([
      ['Firma XY', 2, 0, 0, 2, 0], ['Tisk', 4, 1, 1, 0, 2],
    ]);
    expect(r.reservations).toEqual([expect.objectContaining({ active: 1, paid: 1, expired: 1, cancelled: 0, expiredSeats: 1 })]);
  });

  it('inscenace i období sčítají oba termíny; cizí pořadatel nevidí nic', async () => {
    const prod = await json(await report(`scope=production&productionId=${productionId}`));
    expect(prod.events).toBe(2);
    expect(prod.totals).toEqual({ sold: 10, revenueMinor: 294000, offlineDuplicates: 0 });
    const from = new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 13 * 86_400_000).toISOString().slice(0, 10);
    const per = await json(await report(`scope=period&from=${from}&to=${to}`));
    expect(per.events).toBe(2);
    expect((per.totals as { sold: number }).sold).toBe(10);
    const only1 = await json(await report(`scope=period&from=${from}&to=${new Date(Date.now() + 11 * 86_400_000).toISOString().slice(0, 10)}`));
    expect(only1.events).toBe(1);
    expect((await report('scope=term')).status).toBe(422);

    const other = await clone.seed.chain();
    const { signAccessToken } = await import('@/lib/auth');
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [other.adminUserId])).rows[0].email;
    const t2k = await signAccessToken({ id: other.adminUserId, email, name: 'O' } as never, {
      isPlatformAdmin: false, promoterMemberships: [{ promoterId: other.promoterId, slug: 'o', name: 'o', status: 'active', role: 'owner' }],
    } as never);
    const foreign = await json(await call('GET', `/api/admin/theatre-reports?scope=term&eventId=${t1.eventId}`, () => import('@/app/api/admin/theatre-reports/route'), undefined, {}, t2k));
    expect(foreign.events).toBe(0);
    expect((await call('GET', `/api/admin/events/${t1.eventId}/usher-list`, () => import('@/app/api/admin/events/[id]/usher-list/route'), undefined, { params: { id: t1.eventId } }, t2k)).status).toBe(404);
  });

  it('export CSV a XLSX', async () => {
    const raw = Buffer.from(await (await report(`scope=term&eventId=${t1.eventId}&format=csv`)).arrayBuffer());
    expect([...raw.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM kvůli diakritice v Excelu (Response.text() ho zahodí)
    const csv = raw.subarray(3).toString('utf8');
    expect(csv.startsWith('Termín;Datum;Zóna;Kategorie;Kanál;Prodáno;Tržba (Kč)')).toBe(true);
    expect(csv).toContain(';Balkon;Plné;firemní;2;600');
    expect(csv).toContain(';Přízemí;Student;rezervace;1;350');
    const x = await report(`scope=term&eventId=${t1.eventId}&format=xlsx`);
    expect(x.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const files = unzipSync(new Uint8Array(await x.arrayBuffer()));
    const wb = strFromU8(files['xl/workbook.xml']);
    for (const n of ['Prodej', 'Obsazenost', 'Blokace', 'Rezervace']) expect(wb).toContain(`name="${n}"`);
    const occ = strFromU8(files['xl/worksheets/sheet2.xml']);
    expect(occ).toContain('<v>50</v>');
    const blk = strFromU8(files['xl/worksheets/sheet3.xml']);
    expect(blk).toContain('Firma XY');
    expect(blk).toContain('Tisk');
  });

  it('seznam pro uvaděče: místa, kategorie, jména, ověřit průkaz — JSON, CSV i PDF', async () => {
    const u = await json(await call('GET', `/api/admin/events/${t1.eventId}/usher-list`, () => import('@/app/api/admin/events/[id]/usher-list/route'), undefined, { params: { id: t1.eventId } }));
    const rows = u.rows as Array<{ sector: string; seat: string; category: string | null; name: string | null; verifyId: string | null; hall: string }>;
    expect(rows.map((r) => `${r.sector} ${r.seat}`)).toEqual(['Balkon 1', 'Balkon 2', 'Balkon 3', 'Balkon 4', 'Přízemí 1', 'Přízemí 2', 'Přízemí 3', 'Přízemí 4', 'Přízemí 5']);
    expect(rows.find((r) => r.sector === 'Přízemí' && r.seat === '2')).toMatchObject({ category: 'ZTP/P', verifyId: 'ZTP/P', hall: 'Test Sál' });
    expect(rows.find((r) => r.sector === 'Balkon' && r.seat === '4')?.name).toBe('Novinář Jan');
    expect(rows.find((r) => r.sector === 'Balkon' && r.seat === '2')?.name).toBe('Firma XY s.r.o.');
    const csv = await (await call('GET', `/api/admin/events/${t1.eventId}/usher-list?format=csv`, () => import('@/app/api/admin/events/[id]/usher-list/route'), undefined, { params: { id: t1.eventId } })).text();
    expect(csv).toContain('Test Sál;Přízemí;1;2;ZTP/P;');
    const pdfRes = await call('GET', `/api/admin/events/${t1.eventId}/usher-list?format=pdf`, () => import('@/app/api/admin/events/[id]/usher-list/route'), undefined, { params: { id: t1.eventId } });
    expect(pdfRes.headers.get('content-type')).toBe('application/pdf');
    const text = pdfText(new Uint8Array(await pdfRes.arrayBuffer()));
    expect(text).toContain('seznam pro uvaděče');
    expect(text).toContain('Novinář Jan');
    expect(text).toContain('Ověřit průkaz');
    expect(text).toContain('Student (ISIC)');
  });
});
