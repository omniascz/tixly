/**
 * booking-settlement.live.test.ts — vrstva „od nabidky k vyplate" + re-entry
 * (migrace 472–478) poprve PROTI SKUTECNEMU POSTGRESU.
 *
 * Do ted to bylo overene jen unit testy cistych funkci, `tsc` a buildem.
 * Tady se volaji skutecne route handlery pod `tixly_app` (RLS plati) na klonu
 * produkce, na ktery fixture aplikuje 472–478. Kdyby nektera migrace neprosla,
 * spadne uz `beforeAll`.
 *
 * Kazdy krok asertuje HTTP status A zaroven precte radek zpet z DB
 * owner poolem — 201 bez radku by byla prave ta tiche chyba, kvuli ktere tahle
 * vrstva vznikla (N1: accrue vracel 401 a nikdo si nevsiml).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { createLiveClone, makeSeed, hasLiveDb, type LiveClone } from './helpers/live-fixture';

const d = hasLiveDb ? describe : describe.skip;
const BASE = 'http://localhost:3000';

let clone: LiveClone;
let chain: Awaited<ReturnType<ReturnType<typeof makeSeed>['fullChain']>>;

function req(url: string, uid: string | null, method = 'GET', body?: unknown, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extra };
  if (uid) headers['x-user-id'] = uid;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest(BASE + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
}

async function call(res: Response | unknown) {
  const r = res as Response;
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}

d('booking/settlement + re-entry — zivy beh (472–478)', () => {
  let agreementId: string;

  beforeAll(async () => {
    process.env.INTERNAL_SERVICE_TOKEN = 'live-internal-token';
    clone = await createLiveClone('booking');
    const seed = makeSeed(clone.pool);
    chain = await seed.fullChain();
    await clone.pool.query(`UPDATE platform.promoters SET status = 'active' WHERE id = $1`, [chain.promoterId]);
    // Seed zaklada sal bez poradatele. Pod RLS (p_venues_tenant) takovy sal
    // poradatel nevidi, prestoze date-holds route `promoter_id IS NULL` pripousti
    // — viz samostatny test nize. Hlavni cesta jede nad vlastnim salem.
    await clone.pool.query(`UPDATE catalog.venues SET promoter_id = $2 WHERE id = $1`, [chain.venueId, chain.promoterId]);
  }, 300_000);

  afterAll(async () => { await clone?.cleanup(); }, 120_000);

  it('migrace 472–478 jsou na klonu', async () => {
    const r = await clone.pool.query(
      `SELECT to_regclass('catalog.event_costs') AS a, to_regclass('lineups.artist_settlements') AS b,
              to_regclass('catalog.venue_date_holds') AS c, to_regclass('lineups.artist_offers') AS d,
              (SELECT count(*) FROM information_schema.columns
                WHERE (table_schema, table_name, column_name) IN
                  (('lineups','royalty_agreements','currency'), ('lineups','royalty_agreements','backend_pct'),
                   ('catalog','venue_gates','direction'), ('tickets','scan_events','undone_at'),
                   ('catalog','events','reentry_cooldown_seconds')))::int AS cols`,
    );
    console.log('[schema]', JSON.stringify(r.rows[0]));
    expect(r.rows[0]).toMatchObject({
      a: 'catalog.event_costs', b: 'lineups.artist_settlements',
      c: 'catalog.venue_date_holds', d: 'lineups.artist_offers', cols: 5,
    });
  });

  it('A: smlouva → accrue → vyplatni davka (cesta penez umelci)', async () => {
    const { POST: createAgr } = await import('@/app/api/admin/events/[id]/royalties/route');
    const a = await call(await createAgr(
      req(`/api/admin/events/${chain.eventId}/royalties`, chain.adminUserId, 'POST', {
        artist_name: 'Live Kapela', artist_email: 'kapela@example.cz',
        royalty_type: 'percent', percent_rate: 20, currency: 'CZK', deposit_minor: 500,
      }),
      { params: { id: chain.eventId } } as never,
    ));
    console.log('[A] create agreement', a.status, JSON.stringify(a.json).slice(0, 200));
    expect(a.status).toBe(201);
    agreementId = a.json.id;
    const dbAgr = await clone.pool.query(`SELECT currency, deposit_minor FROM lineups.royalty_agreements WHERE id=$1`, [agreementId]);
    expect(dbAgr.rows[0]).toMatchObject({ currency: 'CZK', deposit_minor: 500 });

    const { POST: accrue } = await import('@/app/api/internal/royalties/accrue/route');
    const ac = await call(await accrue(req('/api/internal/royalties/accrue', null, 'POST',
      { orderId: chain.orderId }, { 'x-internal-token': 'live-internal-token' })));
    console.log('[A] accrue', ac.status, JSON.stringify(ac.json).slice(0, 200));
    expect(ac.status).toBe(200);
    const led = await clone.pool.query(
      `SELECT royalty_amount_halire, ticket_revenue_halire FROM lineups.royalty_ledger WHERE agreement_id=$1`, [agreementId]);
    console.log('[A] ledger', JSON.stringify(led.rows));
    expect(led.rows.length).toBe(1);
    // 20 % z 10000 haleru
    expect(Number(led.rows[0].royalty_amount_halire)).toBe(2000);

    const { POST: calc } = await import('@/app/api/admin/artist-payouts/calculate/route');
    const pc = await call(await calc(req('/api/admin/artist-payouts/calculate', chain.adminUserId, 'POST',
      { periodFrom: new Date(Date.now() - 86400_000).toISOString(), periodTo: new Date(Date.now() + 86400_000).toISOString() })));
    console.log('[A] payouts calculate', pc.status, JSON.stringify(pc.json).slice(0, 300));
    expect(pc.status).toBe(200);
    const po = await clone.pool.query(`SELECT currency, net_amount_halire, gross_royalty_halire FROM lineups.artist_payouts WHERE agreement_id=$1`, [agreementId])
      .catch(async () => clone.pool.query(`SELECT * FROM lineups.artist_payouts WHERE agreement_id=$1`, [agreementId]));
    console.log('[A] artist_payouts', JSON.stringify(po.rows));
    expect(po.rows.length).toBe(1);

    const { GET: preview } = await import('@/app/api/admin/events/[id]/royalties/[agreementId]/preview/route');
    const pv = await call(await preview(req(`/api/admin/events/${chain.eventId}/royalties/${agreementId}/preview`, chain.adminUserId),
      { params: { id: chain.eventId, agreementId } } as never));
    console.log('[A] preview', pv.status, JSON.stringify(pv.json).slice(0, 300));
    expect(pv.status).toBe(200);
  }, 180_000);

  it('B: rozpocet + bod zlomu', async () => {
    const { POST: addCost, GET: listCosts } = await import('@/app/api/admin/events/[id]/costs/route');
    const p = { params: { id: chain.eventId } } as never;
    const c1 = await call(await addCost(req(`/api/admin/events/${chain.eventId}/costs`, chain.adminUserId, 'POST',
      { category: 'venue', description: 'Pronajem', amountMinor: 1_000_000, vatRatePct: 21 }), p));
    const c2 = await call(await addCost(req(`/api/admin/events/${chain.eventId}/costs`, chain.adminUserId, 'POST',
      { category: 'production', description: 'Naramek', amountMinor: 1_000, isPerAttendee: true }), p));
    console.log('[B] add costs', c1.status, c2.status, JSON.stringify(c1.json).slice(0, 160));
    expect([c1.status, c2.status]).toEqual([201, 201]);
    const l = await call(await listCosts(req(`/api/admin/events/${chain.eventId}/costs`, chain.adminUserId), p));
    console.log('[B] list', l.status, JSON.stringify(l.json).slice(0, 300));
    expect(l.status).toBe(200);

    const { GET: be } = await import('@/app/api/admin/events/[id]/break-even/route');
    const b = await call(await be(req(`/api/admin/events/${chain.eventId}/break-even`, chain.adminUserId), p));
    console.log('[B] break-even', b.status, JSON.stringify(b.json).slice(0, 400));
    expect(b.status).toBe(200);
    // Rucne: 100 Kc vc. 12 % DPH -> zaklad 89,29; provize 5 % z hrube = 5,00;
    // naramek 10,00 -> prispevek 74,29 Kc.
    // Z kroku A je aktivni smlouva 20 % z hrube (= 20 Kc/vst.) -> 54,29 Kc;
    // 10 000 Kc / 54,29 = 184,2 -> 185 (bez honorare by to bylo 135).
    expect(b.json.breakEven.contributionPerTicketMinor).toBe(7429);
    expect(b.json.breakEven.dealCount).toBe(1);
    expect(b.json.breakEven.artistFeesCurrentMinor).toBe(2000);
    expect(b.json.breakEven.ticketsNeeded).toBe(185);
  }, 120_000);

  it('D: vyuctovani — vytvorit, uzavrit, snimek se nemeni', async () => {
    const { POST: create } = await import('@/app/api/admin/events/[id]/artist-settlements/route');
    const s = await call(await create(req(`/api/admin/events/${chain.eventId}/artist-settlements`, chain.adminUserId, 'POST',
      { agreementId }), { params: { id: chain.eventId } } as never));
    console.log('[D] create', s.status, JSON.stringify(s.json).slice(0, 300));
    expect(s.status).toBe(201);
    const settlementId = s.json.id ?? s.json.settlement?.id;
    expect(settlementId).toBeTruthy();

    const { POST: close } = await import('@/app/api/admin/events/[id]/artist-settlements/[settlementId]/close/route');
    const cl = await call(await close(req(`/api/admin/events/${chain.eventId}/artist-settlements/${settlementId}/close`, chain.adminUserId, 'POST', {}),
      { params: { id: chain.eventId, settlementId } } as never));
    console.log('[D] close', cl.status, JSON.stringify(cl.json).slice(0, 300));
    expect(cl.status).toBe(200);

    const before = await clone.pool.query(`SELECT status, payable_minor, tickets_sold FROM lineups.artist_settlements WHERE id=$1`, [settlementId]);
    console.log('[D] db', JSON.stringify(before.rows[0]));
    expect(before.rows[0].status).not.toBe('draft');

    const cl2 = await call(await close(req(`/api/admin/events/${chain.eventId}/artist-settlements/${settlementId}/close`, chain.adminUserId, 'POST', {}),
      { params: { id: chain.eventId, settlementId } } as never));
    console.log('[D] close podruhe', cl2.status);
    expect(cl2.status).toBe(409);

    // Dvoji vyplata: A zalozilo prubeznou vyplatu 20 Kc (pending). Uzavreni ji
    // musi zrusit a nahradit vyplatou z vyuctovani (15 Kc), ne pridat vedle.
    const pays = await clone.pool.query(
      `SELECT status, net_payout_halire FROM lineups.artist_payouts WHERE agreement_id=$1 ORDER BY created_at`, [agreementId]);
    console.log('[D] vyplaty smlouvy po uzavreni', JSON.stringify(pays.rows));
    const live = pays.rows.filter((r) => r.status !== 'cancelled');
    expect(live.length).toBe(1);
    expect(Number(live[0].net_payout_halire)).toBe(1500);
    expect(pays.rows.some((r) => r.status === 'cancelled' && Number(r.net_payout_halire) === 2000)).toBe(true);

    // Po uzavrenem vyuctovani prubezny vypocet smlouvu preskoci.
    const { POST: calc } = await import('@/app/api/admin/artist-payouts/calculate/route');
    const pc = await call(await calc(req('/api/admin/artist-payouts/calculate', chain.adminUserId, 'POST',
      { periodFrom: new Date(Date.now() - 86400_000).toISOString(), periodTo: new Date(Date.now() + 86400_000).toISOString(), agreementIds: [agreementId] })));
    console.log('[D] calculate po uzavreni', pc.status, JSON.stringify(pc.json).slice(0, 160));
    expect(pc.json.created).toBe(0);

    const { GET: one } = await import('@/app/api/admin/events/[id]/artist-settlements/[settlementId]/route');
    const g = await call(await one(req(`/api/admin/events/${chain.eventId}/artist-settlements/${settlementId}`, chain.adminUserId),
      { params: { id: chain.eventId, settlementId } } as never));
    console.log('[D] get', g.status, JSON.stringify(g.json).slice(0, 200));
    expect(g.status).toBe(200);
  }, 120_000);

  it('D2: schvalena prubezna vyplata se odecte; zmena mezi konceptem a uzavrenim -> 409', async () => {
    const { POST: createAgr } = await import('@/app/api/admin/events/[id]/royalties/route');
    const a2 = await call(await createAgr(req(`/api/admin/events/${chain.eventId}/royalties`, chain.adminUserId, 'POST',
      { artist_name: 'Predkapela', royalty_type: 'percent', percent_rate: 10, currency: 'CZK' }),
      { params: { id: chain.eventId } } as never));
    expect(a2.status).toBe(201);
    const agr2 = a2.json.id as string;
    const { POST: accrue } = await import('@/app/api/internal/royalties/accrue/route');
    await accrue(req('/api/internal/royalties/accrue', null, 'POST', { orderId: chain.orderId }, { 'x-internal-token': 'live-internal-token' }));
    const { POST: calc } = await import('@/app/api/admin/artist-payouts/calculate/route');
    const pc = await call(await calc(req('/api/admin/artist-payouts/calculate', chain.adminUserId, 'POST',
      { periodFrom: new Date(Date.now() - 86400_000).toISOString(), periodTo: new Date(Date.now() + 86400_000).toISOString(), agreementIds: [agr2] })));
    console.log('[D2] calculate', pc.status, JSON.stringify(pc.json).slice(0, 160));
    expect(pc.json.created).toBe(1);
    const p2 = pc.json.payouts[0].id as string;
    expect(pc.json.payouts[0].net_payout_halire).toBe(1000);

    const { POST: create } = await import('@/app/api/admin/events/[id]/artist-settlements/route');
    const { POST: close } = await import('@/app/api/admin/events/[id]/artist-settlements/[settlementId]/close/route');
    const build = async () => call(await create(req(`/api/admin/events/${chain.eventId}/artist-settlements`, chain.adminUserId, 'POST',
      { agreementId: agr2 }), { params: { id: chain.eventId } } as never));
    const closeIt = async (sid: string) => call(await close(req(`/api/admin/events/${chain.eventId}/artist-settlements/${sid}/close`, chain.adminUserId, 'POST', {}),
      { params: { id: chain.eventId, settlementId: sid } } as never));

    const s1 = await build();
    console.log('[D2] koncept (vyplata jeste pending)', s1.status, JSON.stringify(s1.json).slice(0, 200));
    expect(s1.json.payableMinor).toBe(1000);

    // Mezitim nekdo prubeznou vyplatu schvali.
    await clone.pool.query(`UPDATE lineups.artist_payouts SET status='approved' WHERE id=$1`, [p2]);
    const stale = await closeIt(s1.json.id);
    console.log('[D2] uzavreni zastaraleho konceptu', stale.status, JSON.stringify(stale.json).slice(0, 120));
    expect(stale.status).toBe(409);
    expect(stale.json.error).toBe('STALE_DRAFT');

    const s2 = await build();
    console.log('[D2] novy koncept', s2.status, JSON.stringify(s2.json).slice(0, 300));
    expect(s2.json.id).toBe(s1.json.id); // tentyz koncept prepocitany, ne druhy
    expect(s2.json.payableMinor).toBe(0);
    expect(s2.json.lines.some((l: any) => l.key === 'already_paid' && l.amountMinor === -1000)).toBe(true);

    const ok = await closeIt(s2.json.id);
    console.log('[D2] uzavreni', ok.status, JSON.stringify(ok.json).slice(0, 160));
    expect(ok.status).toBe(200);
    expect(ok.json.payoutId).toBeNull();
    const pays = await clone.pool.query(`SELECT status, net_payout_halire FROM lineups.artist_payouts WHERE agreement_id=$1`, [agr2]);
    console.log('[D2] vyplaty', JSON.stringify(pays.rows));
    expect(pays.rows).toEqual([{ status: 'approved', net_payout_halire: 1000 }]);
  }, 180_000);

  it('E: opce na termin — poradi, potvrzeni zalozi akci', async () => {
    const { POST: hold, GET: list } = await import('@/app/api/admin/date-holds/route');
    const date = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);
    const h1 = await call(await hold(req('/api/admin/date-holds', chain.adminUserId, 'POST',
      { venueId: chain.venueId, holdDate: date, title: 'Opce 1', artistName: 'Kapela 1' })));
    const h2 = await call(await hold(req('/api/admin/date-holds', chain.adminUserId, 'POST',
      { venueId: chain.venueId, holdDate: date, title: 'Opce 2' })));
    console.log('[E] holds', h1.status, h2.status, JSON.stringify(h1.json).slice(0, 200), JSON.stringify(h2.json).slice(0, 200));
    expect([h1.status, h2.status]).toEqual([201, 201]);
    const ranks = await clone.pool.query(
      `SELECT title, option_rank, status FROM catalog.venue_date_holds WHERE venue_id=$1 AND hold_date=$2 ORDER BY option_rank`,
      [chain.venueId, date]);
    console.log('[E] db', JSON.stringify(ranks.rows));
    expect(ranks.rows.map((r) => r.option_rank)).toEqual([1, 2]);

    const l = await call(await list(req(`/api/admin/date-holds?from=${date}&to=${date}`, chain.adminUserId)));
    console.log('[E] list', l.status, JSON.stringify(l.json).slice(0, 200));
    expect(l.status).toBe(200);

    const h1Id = h1.json.id ?? h1.json.hold?.id;
    const { POST: confirm } = await import('@/app/api/admin/date-holds/[holdId]/confirm/route');
    const cf = await call(await confirm(req(`/api/admin/date-holds/${h1Id}/confirm`, chain.adminUserId, 'POST', { startTime: '19:30' }),
      { params: { holdId: h1Id } } as never));
    console.log('[E] confirm', cf.status, JSON.stringify(cf.json).slice(0, 300));
    expect(cf.status).toBe(200);
    const after = await clone.pool.query(
      `SELECT h.status, h.event_id, e.status AS ev_status FROM catalog.venue_date_holds h
         LEFT JOIN catalog.events e ON e.id = h.event_id WHERE h.id=$1`, [h1Id]);
    console.log('[E] po potvrzeni', JSON.stringify(after.rows[0]));
    expect(after.rows[0].status).toBe('confirmed');
    expect(after.rows[0].event_id).toBeTruthy();
    expect(after.rows[0].ev_status).not.toBe('published');

    const { POST: expire } = await import('@/app/api/internal/cron/expire-date-holds/route');
    const ex = await call(await expire(req('/api/internal/cron/expire-date-holds', null, 'POST', {},
      { 'x-internal-token': 'live-internal-token' })));
    console.log('[E] cron expire', ex.status, JSON.stringify(ex.json).slice(0, 200));
    expect(ex.status).toBe(200);
  }, 120_000);

  it('E2: opce na sal BEZ poradatele (sdileny sal) — co se stane pod RLS', async () => {
    const shared = (await clone.pool.query<{ id: string }>(
      `INSERT INTO catalog.venues (name, city, country, capacity) VALUES ('Sdileny Sal', 'Praha', 'CZ', 300) RETURNING id`)).rows[0].id;
    const { POST: hold } = await import('@/app/api/admin/date-holds/route');
    const date = new Date(Date.now() + 120 * 86400_000).toISOString().slice(0, 10);
    const h = await call(await hold(req('/api/admin/date-holds', chain.adminUserId, 'POST',
      { venueId: shared, holdDate: date, title: 'Opce na sdileny sal' })));
    // Zamerne bez assertu na konkretni status — meri se skutecnost a hlasi.
    console.log('[E2] sdileny sal ->', h.status, JSON.stringify(h.json).slice(0, 160));
    expect([201, 404]).toContain(h.status);
  }, 60_000);

  it('F: nabidka → odkaz → prijeti agentem → smlouva + nakladova polozka', async () => {
    const { POST: create } = await import('@/app/api/admin/events/[id]/offers/route');
    const p = { params: { id: chain.eventId } } as never;
    const o = await call(await create(req(`/api/admin/events/${chain.eventId}/offers`, chain.adminUserId, 'POST', {
      artistName: 'Nabidnuta Kapela', agentEmail: 'agent@example.cz', royaltyType: 'percent',
      percentRate: 15, minGuaranteeMinor: 2_000_000, currency: 'CZK',
    }), p));
    console.log('[F] create', o.status, JSON.stringify(o.json).slice(0, 200));
    expect(o.status).toBe(201);
    const offerId = o.json.id;

    const { POST: send } = await import('@/app/api/admin/events/[id]/offers/[offerId]/send/route');
    const s = await call(await send(req(`/api/admin/events/${chain.eventId}/offers/${offerId}/send`, chain.adminUserId, 'POST', { validDays: 7 }),
      { params: { id: chain.eventId, offerId } } as never));
    console.log('[F] send', s.status, JSON.stringify(s.json).slice(0, 200));
    expect(s.status).toBe(200);
    const token = String(s.json.link).split('/nabidka/')[1];
    expect(token).toBeTruthy();

    const { GET: view } = await import('@/app/api/offers/[token]/route');
    const v = await call(await view(req(`/api/offers/${token}`, null), { params: { token } } as never));
    console.log('[F] agent view', v.status, JSON.stringify(v.json).slice(0, 200));
    expect(v.status).toBe(200);

    const { POST: respond } = await import('@/app/api/offers/[token]/respond/route');
    const r = await call(await respond(req(`/api/offers/${token}/respond`, null, 'POST',
      { action: 'accept', signerName: 'Agent Novak', signerEmail: 'agent@example.cz' }), { params: { token } } as never));
    console.log('[F] accept', r.status, JSON.stringify(r.json).slice(0, 300));
    expect(r.status).toBe(200);

    const off = await clone.pool.query(
      `SELECT o.status, o.agreement_id, o.cost_id, a.percent_rate, a.min_guarantee_halire, c.amount_minor, c.category
         FROM lineups.artist_offers o
         LEFT JOIN lineups.royalty_agreements a ON a.id = o.agreement_id
         LEFT JOIN catalog.event_costs c ON c.id = o.cost_id
        WHERE o.id = $1`, [offerId]);
    console.log('[F] db', JSON.stringify(off.rows[0]));
    expect(off.rows[0]).toMatchObject({ status: 'accepted', category: 'artist' });
    expect(Number(off.rows[0].min_guarantee_halire)).toBe(2_000_000);
    expect(Number(off.rows[0].amount_minor)).toBe(2_000_000);

    // Vyuctovani teto smlouvy: polozka „Honorar — …" (garance 20 000 Kc) je
    // navazana na smlouvu a NESMI byt mezi naklady — podil nad bodem zlomu
    // garanci odecita sam. V nakladech akce zustava jen pronajem z kroku B.
    const { POST: buildSettlement } = await import('@/app/api/admin/events/[id]/artist-settlements/route');
    const st = await call(await buildSettlement(req(`/api/admin/events/${chain.eventId}/artist-settlements`, chain.adminUserId, 'POST',
      { agreementId: off.rows[0].agreement_id }), { params: { id: chain.eventId } } as never));
    const fixed = await clone.pool.query(`SELECT fixed_costs_minor FROM lineups.artist_settlements WHERE id=$1`, [st.json.id]);
    console.log('[F] vyuctovani z nabidky', st.status, 'fixed_costs_minor =', fixed.rows[0]?.fixed_costs_minor);
    expect(st.status).toBe(201);
    expect(Number(fixed.rows[0].fixed_costs_minor)).toBe(1_000_000);

    const again = await call(await respond(req(`/api/offers/${token}/respond`, null, 'POST',
      { action: 'accept', signerName: 'Agent Novak' }), { params: { token } } as never));
    console.log('[F] accept podruhe', again.status);
    expect(again.status).toBeGreaterThanOrEqual(400);
  }, 120_000);

  it('G: re-entry — automaticky smer, undo', async () => {
    await clone.pool.query(
      `UPDATE catalog.events SET reentry_allowed = TRUE, reentry_cooldown_seconds = 0 WHERE id = $1`, [chain.eventId]);
    const ticketId = (await clone.pool.query(`SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1`, [chain.orderId])).rows[0].id;
    const { POST: pass } = await import('@/app/api/admin/scanner/passage/route');
    const p1 = await call(await pass(req('/api/admin/scanner/passage', chain.adminUserId, 'POST', { ticketId })));
    console.log('[G] 1. pruchod', p1.status, JSON.stringify(p1.json).slice(0, 250));
    expect(p1.status).toBe(200);
    const p2 = await call(await pass(req('/api/admin/scanner/passage', chain.adminUserId, 'POST', { ticketId })));
    console.log('[G] 2. pruchod', p2.status, JSON.stringify(p2.json).slice(0, 250));
    expect(p2.status).toBe(200);
    const st = await clone.pool.query(`SELECT currently_inside, scan_count FROM tickets.tickets WHERE id=$1`, [ticketId]);
    console.log('[G] po 2 pruchodech', JSON.stringify(st.rows[0]));
    expect(st.rows[0].currently_inside).toBe(false);

    const { POST: undo } = await import('@/app/api/admin/scanner/passage/undo/route');
    const u = await call(await undo(req('/api/admin/scanner/passage/undo', chain.adminUserId, 'POST', { ticketId, reason: 'spatny smer' })));
    console.log('[G] undo', u.status, JSON.stringify(u.json).slice(0, 250));
    expect(u.status).toBe(200);
    const st2 = await clone.pool.query(`SELECT currently_inside FROM tickets.tickets WHERE id=$1`, [ticketId]);
    const undone = await clone.pool.query(`SELECT count(*)::int AS n FROM tickets.scan_events WHERE ticket_id=$1 AND undone_at IS NOT NULL`, [ticketId]);
    console.log('[G] po undo', JSON.stringify(st2.rows[0]), 'undone scanu:', undone.rows[0].n);
    expect(st2.rows[0].currently_inside).toBe(true);
    expect(undone.rows[0].n).toBe(1);

    const { GET: occ } = await import('@/app/api/admin/events/[id]/occupancy/route');
    const oc = await call(await occ(req(`/api/admin/events/${chain.eventId}/occupancy`, chain.adminUserId), { params: { id: chain.eventId } } as never));
    console.log('[G] occupancy', oc.status, JSON.stringify(oc.json).slice(0, 200));
    expect(oc.status).toBe(200);
  }, 120_000);

  it('dashboard overview', async () => {
    const { GET } = await import('@/app/api/admin/stats/overview/route');
    const r = await call(await GET(req('/api/admin/stats/overview', chain.adminUserId)));
    console.log('[stats]', r.status, JSON.stringify(r.json).slice(0, 300));
    expect(r.status).toBe(200);
  }, 60_000);
});
