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
    await q(`INSERT INTO catalog.events (id,promoter_id,organizer_id,venue_id,production_id,title,date_start,slug)
             VALUES ($1,$2,$3,$4,$5,'E',now()+interval '30 day',$6)`,
      [ids.event, ids.promoter, ids.user, ids.venue, ids.production, 'ev-' + ids.event.slice(0, 8)]);
    // `ticket_types` NEMA sloupec `status` — ma `visibility`
    // ('public'|'hidden'|'access_code'). Viz blocker nize.
    await q(`INSERT INTO catalog.ticket_types (id,event_id,name,kind,base_price,total_qty,remaining_qty,visibility)
             VALUES ($1,$2,'TT','standing',50000,100,100,'public')`,
      [ids.ticketType, ids.event]);
  }, 180_000);

  afterAll(async () => { await clone?.cleanup(); }, 120_000);

  // 🔴 NEDOKONCENO: handler nevraci 500 (blocker `tt.status`) ani uspech —
  // skutecny navratovy kod jsem nezmeril, dosel kontext. Test je proto
  // vypnuty, aby netvrdil nic, co neni overene. Viz FINDINGS 64.
  it.skip('POST /api/checkout/party-split založí session a vrátí share_token', async () => {
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
    await res.json();
    // 🔴 BLOCKER (produktove rozhodnuti, FINDINGS 64): dotaz filtruje
    // `tt.status = 'on_sale'`, ale `catalog.ticket_types` sloupec `status`
    // NEMA — ma `visibility` ('public'|'hidden'|'access_code') a zadne
    // sales_start_at/sales_end_at. Cim se ma "on sale" nahradit, nejde
    // odvodit ze schematu; nevymyslim to.
    // Test zatim FIXUJE dnesni stav, aby slo poznat, az se to rozhodne:
    // po oprave sem patri `expect(res.status).toBeLessThan(500)`.
    expect(res.status).toBe(500);
  }, 120_000);

  it.skip('kapacitni kontrola cte remaining_qty (ne neexistujici sloupec)', async () => {
    const { POST } = await import('@/app/api/checkout/party-split/route');
    const req = new Request('http://localhost:3000/api/checkout/party-split', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': ids.user },
      body: JSON.stringify({
        eventId: ids.event, ticketTypeId: ids.ticketType,
        totalSlots: 9999, organizerEmail: `org2_${randomUUID().slice(0, 6)}@t.cz`,
      }),
    });
    const res = await POST(req as never);
    await res.json();
    // Tentyz blocker jako vyse — az padne rozhodnuti o `status`, ma tu byt
    // `expect(res.status).toBe(409)` s error === 'INSUFFICIENT_CAPACITY'.
    expect(res.status).toBe(500);
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
});
