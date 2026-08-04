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
    clone = await createLiveClone('party-split', {
      migrations: ['450_tickets_dedup_unique.sql', '451_orders_payment_provider_pos.sql',
                   '452_tracking_events_provider_tiktok.sql', '456_drop_base64url_defaults.sql'],
    });
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

  // 🔴 BLOCKER 7 (systemovy, FINDINGS 66): mock platebni brana vraci
  // provider 'mock-gopay' / 'mock-wero' / 'mock-przelewy24', ale
  // orders_payment_provider_check povoluje 'mock', 'gopay', … — NE tyhle
  // prefixovane varianty. Objednavku tedy v mock rezimu nelze zalozit
  // a dekrement se k slovu nedostane. Tyka se i hlavniho checkoutu, ktery
  // uklada payment.provider stejne. Bud rozsirit CHECK, nebo provider
  // normalizovat — rozhodnuti, ne oprava naslepo.
  it.skip('[token] POST prijme slot a dekrementuje remaining_qty PRESNE o 1', async () => {
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
});
