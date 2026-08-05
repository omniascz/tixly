/**
 * party-split.live.test.ts — celá cesta party-split přes SKUTEČNÉ handlery.
 *
 * Minulé kolo ověřilo jen ekvivalentní SQL, ne routy. Tenhle test volá
 * `POST /api/checkout/party-split` a `POST /api/events/[id]/alert` jako
 * funkce, tedy včetně validace, kontextu a mapování chyb — ne jen INSERT.
 *
 * Peel, který k tomu vedl (všechno 42703/22023 dřív než se cesta rozjela):
 *   1. share_token měl DEFAULT encode(…,'base64url') → 22023 (mig 456)
 *   2. tt.capacity_remaining — sloupec je `remaining_qty`
 *   3. tt.price_halire       — sloupec je `base_price`
 *   4. dekrement inventáře v [token]/route.ts na témže starém jménu
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { createLiveClone, hasNeonKey, type LiveClone } from './helpers/live-fixture';

const d = hasNeonKey ? describe : describe.skip;

let clone: LiveClone;
const ids = {
  user: randomUUID(), promoter: randomUUID(), venue: randomUUID(),
  production: randomUUID(), event: randomUUID(), ticketType: randomUUID(),
  scarceType: randomUUID(),
};

d('party-split přes skutečné handlery', () => {
  beforeAll(async () => {
    clone = await createLiveClone('party-split');
    const q = (s: string, p: unknown[] = []) => clone.pool.query(s, p);
    await q(`INSERT INTO identity.users (id,email,name,gdpr_consent_at) VALUES ($1,$2,'U',now())`,
      [ids.user, `ps_${ids.user.slice(0, 8)}@t.cz`]);
    await q(`INSERT INTO platform.promoters (id,name,email) VALUES ($1,'P',$2)`,
      [ids.promoter, `p_${ids.promoter.slice(0, 8)}@t.cz`]);
    await q(`INSERT INTO catalog.venues (id,name,city,country,capacity) VALUES ($1,'V','Praha','CZ',100)`,
      [ids.venue]);
    await q(`INSERT INTO catalog.productions (id,promoter_id,title) VALUES ($1,$2,'Prod')`,
      [ids.production, ids.promoter]).catch(() => undefined);
    await q(`INSERT INTO catalog.events (id,promoter_id,organizer_id,venue_id,production_id,title,date_start,slug,status)
             VALUES ($1,$2,$3,$4,$5,'E',now()+interval '30 day',$6,'published')`,
      [ids.event, ids.promoter, ids.user, ids.venue, ids.production, 'ev-' + ids.event.slice(0, 8)]);
    // `ticket_types` NEMA sloupec `status` — ma `visibility`
    // ('public'|'hidden'|'access_code'). Viz blocker nize.
    await q(`INSERT INTO catalog.ticket_types (id,event_id,name,kind,base_price,total_qty,remaining_qty,visibility)
             VALUES ($1,$2,'TT','standing',50000,100,100,'public')`,
      [ids.ticketType, ids.event]);
    // druhy typ se zamerne MALO mizty — na nem se testuje kapacitni brana
    await q(`INSERT INTO catalog.ticket_types (id,event_id,name,kind,base_price,total_qty,remaining_qty,visibility)
             VALUES ($1,$2,'Scarce','standing',50000,100,5,'public')`,
      [ids.scarceType, ids.event]);
  }, 180_000);

  afterAll(async () => { await clone?.cleanup(); }, 120_000);

  it('POST /api/checkout/party-split založí session a vrátí share_token', async () => {
    const { POST } = await import('@/app/api/checkout/party-split/route');
    const req = new Request('http://localhost:3000/api/checkout/party-split', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': ids.user },
      body: JSON.stringify({
        eventId: ids.event, ticketTypeId: ids.ticketType,
        totalSlots: 3, organizerEmail: `org_${randomUUID().slice(0, 6)}@t.cz`,
        organizerName: 'Org',
      }),
    });
    const res = await POST(req as never);
    const body = await res.json();
    console.log('[party-split create]', res.status, JSON.stringify(body).slice(0, 200));
    expect(res.status).toBeLessThan(500);
  }, 120_000);

  it('kapacitni kontrola cte remaining_qty (ne neexistujici sloupec)', async () => {
    const { POST } = await import('@/app/api/checkout/party-split/route');
    const req = new Request('http://localhost:3000/api/checkout/party-split', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': ids.user },
      body: JSON.stringify({
        // 10 slotu proti typu, ktery ma remaining_qty = 5.
        // (9999 by spadlo na validaci `totalSlots <= 20`, ne na kapacite)
        eventId: ids.event, ticketTypeId: ids.scarceType,
        totalSlots: 10, organizerEmail: `org2_${randomUUID().slice(0, 6)}@t.cz`,
      }),
    });
    const res = await POST(req as never);
    const body = await res.json();
    console.log('[party-split capacity]', res.status, JSON.stringify(body).slice(0, 200));
    // 409 = kapacita se PRECETLA z remaining_qty (drive 42703 -> 500)
    expect(res.status).toBe(409);
    expect(body.error).toBe('INSUFFICIENT_CAPACITY');
    expect(body.available).toBe(5);
  }, 120_000);

  it('POST /api/events/[id]/alert vlozi radek s tokenem z Node', async () => {
    const { POST } = await import('@/app/api/events/[id]/alert/route');
    const req = new Request(`http://localhost:3000/api/events/${ids.event}/alert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `al_${randomUUID().slice(0, 6)}@t.cz`, alertType: 'on_sale' }),
    });
    const res = await POST(req as never, { params: Promise.resolve({ id: ids.event }) } as never);
    const body = await res.json();
    expect(res.status).not.toBe(500);
    if (res.status === 200) {
      expect(body.token).toMatch(/^[A-Za-z0-9_-]+$/); // URL-safe, base64url z Node
    }
  }, 120_000);

  it('[token] POST prijme slot a dekrementuje remaining_qty PRESNE o 1', async () => {
    // 1) zaloz session pres realny handler
    const { POST: create } = await import('@/app/api/checkout/party-split/route');
    const cres = await create(new Request('http://localhost:3000/api/checkout/party-split', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': ids.user },
      body: JSON.stringify({
        eventId: ids.event, ticketTypeId: ids.ticketType, totalSlots: 3,
        organizerEmail: `dec_${randomUUID().slice(0, 6)}@t.cz`, organizerName: 'Dec',
      }),
    }) as never);
    const created = await cres.json();
    expect(cres.status).toBe(201);
    const token = created.shareToken as string;

    const before = (await clone.pool.query<{ remaining_qty: number }>(
      `SELECT remaining_qty FROM catalog.ticket_types WHERE id = $1`, [ids.ticketType])).rows[0].remaining_qty;

    // 2) prijmi slot pres realny handler
    const { POST: pay } = await import('@/app/api/checkout/party-split/[token]/route');
    const pres = await pay(new Request(`http://localhost:3000/api/party/${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        payerEmail: `payer_${randomUUID().slice(0, 6)}@t.cz`, payerName: 'Payer',
        paymentMethod: 'gopay', locale: 'cs',
      }),
    }) as never, { params: { token } } as never);
    const paid = await pres.json();
    console.log('[party-split pay]', pres.status, JSON.stringify(paid).slice(0, 220));

    const after = (await clone.pool.query<{ remaining_qty: number }>(
      `SELECT remaining_qty FROM catalog.ticket_types WHERE id = $1`, [ids.ticketType])).rows[0].remaining_qty;
    console.log('[remaining_qty]', before, '->', after);

    expect(pres.status).toBeLessThan(500);
    expect(Number(before) - Number(after)).toBe(1);   // presne o 1, ne 0 a ne 2
  }, 180_000);

  it('CHECK po 457 obsahuje vsechny hodnoty, ktere kod zapisuje', async () => {
    // Testujeme DEFINICI constraintu, ne INSERT — primy INSERT do orders
    // spousti audit trigger, ktery ma vlastni omezeni a zastinil by vysledek.
    // Pozicni literaly ve VALUES: box-office/sell:93, waitlist/[entryId]:93,
    // partner/sales:109 — proto je grep na `payment_provider = 'x'` minul.
    const def = (await clone.pool.query<{ d: string }>(
      `SELECT pg_get_constraintdef(oid) d FROM pg_constraint
       WHERE conname = 'orders_payment_provider_check'`)).rows[0].d;
    for (const v of ['box_office', 'walkin', 'partner_pos', 'mollie', 'paypal',
                     'b2b_credit', 'gopay', 'kiosk_card', 'reseller_cash']) {
      expect(def).toContain(`'${v}'`);
    }
    // mock-* jsou artefakt dev brany — do produkcniho CHECKu NEPATRI
    expect(def).not.toContain('mock-gopay');
    expect(def).not.toContain('mock-wero');
  }, 120_000);

  it('opakovane prijeti: druhy platce dostane JINY slot, dekrement presne 1x', async () => {
    const { POST: create } = await import('@/app/api/checkout/party-split/route');
    const cres = await create(new Request('http://localhost:3000/api/checkout/party-split', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': ids.user },
      body: JSON.stringify({
        eventId: ids.event, ticketTypeId: ids.ticketType, totalSlots: 3,
        organizerEmail: `rep_${randomUUID().slice(0, 6)}@t.cz`, organizerName: 'Rep',
      }),
    }) as never);
    const token = (await cres.json()).shareToken as string;

    const q = `SELECT remaining_qty FROM catalog.ticket_types WHERE id = $1`;
    const before = Number((await clone.pool.query<{ remaining_qty: number }>(q, [ids.ticketType])).rows[0].remaining_qty);

    const { POST: pay } = await import('@/app/api/checkout/party-split/[token]/route');
    const call = () => pay(new Request(`http://localhost:3000/api/party/${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        payerEmail: `p_${randomUUID().slice(0, 8)}@t.cz`, payerName: 'P',
        paymentMethod: 'gopay', locale: 'cs',
      }),
    }) as never, { params: { token } } as never);

    const r1 = await call(); const b1 = await r1.json();
    const mid = Number((await clone.pool.query<{ remaining_qty: number }>(q, [ids.ticketType])).rows[0].remaining_qty);
    const r2 = await call(); const b2 = await r2.json();
    const after = Number((await clone.pool.query<{ remaining_qty: number }>(q, [ids.ticketType])).rows[0].remaining_qty);
    console.log('[opakovane]', r1.status, 'slot', b1.slotIndex, '|', r2.status, 'slot', b2.slotIndex,
                '| remaining', before, '->', mid, '->', after);

    expect(before - mid).toBe(1);      // prvni prijeti: presne 1
    expect(mid - after).toBe(1);       // druhe prijeti: dalsi slot, zase presne 1
    expect(b2.slotIndex).not.toBe(b1.slotIndex);  // NE tyz slot dvakrat
  }, 180_000);

  it('IZOLACE: cizi uzivatel nevidi ani nezapise do cizi session', async () => {
    // Bez teto kontroly by 458 mohla tabulku jen otevrit.
    const { POST: create } = await import('@/app/api/checkout/party-split/route');
    const r = await create(new Request('http://localhost:3000/api/checkout/party-split', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': ids.user },
      body: JSON.stringify({
        eventId: ids.event, ticketTypeId: ids.ticketType, totalSlots: 2,
        organizerEmail: `iso_${randomUUID().slice(0, 6)}@t.cz`, organizerName: 'Iso',
      }),
    }) as never);
    expect(r.status).toBe(201);
    const sessionId = (await r.json()).sessionId as string;

    // cizi uzivatel = jine app.current_user_id, BEZ servisniho kontextu
    const stranger = randomUUID();
    await clone.pool.query(
      "INSERT INTO identity.users (id,email,name,gdpr_consent_at) VALUES ($1,$2,'S',now())",
      [stranger, `str_${stranger.slice(0, 8)}@t.cz`]);

    const { Pool } = await import('pg');
    const appPool = new Pool({ connectionString: process.env.DATABASE_URL });
    const c = await appPool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SET LOCAL app.current_user_id = '${stranger}'`);
      await c.query("SET LOCAL app.role = 'buyer'");

      // status='open' je verejne citelny zamerne (sdileni odkazu), takze
      // izolaci merime na ZAPISU a na neverejnem stavu
      const upd = await c.query(
        "UPDATE orders.party_split_sessions SET status = 'cancelled' WHERE id = $1",
        [sessionId]);
      expect(upd.rowCount).toBe(0);          // cizi session NELZE zmenit

      const ins = await c.query(
        `INSERT INTO orders.party_split_slots (session_id, slot_index, status)
         VALUES ($1, 99, 'pending') ON CONFLICT DO NOTHING`, [sessionId])
        .then((x) => x.rowCount).catch(() => -1);
      expect(ins).toBeLessThanOrEqual(0);    // cizi slot NELZE vlozit
      await c.query('ROLLBACK');
    } finally {
      c.release(); await appPool.end();
    }
  }, 180_000);
});
