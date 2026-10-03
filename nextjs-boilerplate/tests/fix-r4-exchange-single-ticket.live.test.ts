// @vitest-environment node
/**
 * Kolo 4 / krok 3e — výměna vstupenky za jiný termín (POST /api/buyer/tickets/[id]/exchange)
 * měnila `orders.event_id` CELÉ objednávky (FIX_REPORT_R3 bod 4). Akce vstupenky se odvozuje
 * z objednávky, takže u objednávky se dvěma vstupenkami se na nový termín „přestěhovala"
 * i druhá, nevyměněná vstupenka (u vchodu původního termínu by ji skener odmítl jako jinou akci).
 * Navíc vyměněná vstupenka zůstala typem PŮVODNÍ akce.
 *
 * Očekávané: vyměněná vstupenka patří k cílovému termínu a má typ cílové akce; ostatní
 * vstupenky objednávky zůstanou u původního termínu; kapacita: cíl −1, zdroj +1.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;

run('Krok 3e (kolo 4) — výměna mění jen vyměněnou vstupenku', () => {
  let clone: LocalClone;
  let src: Awaited<ReturnType<LocalClone['seed']['chain']>>;
  let tgtEventId: string;
  let tgtTypeId: string;
  let orderId: string;
  let tickets: string[];
  let tok: string;

  beforeAll(async () => {
    clone = await createLocalClone();
    src = await clone.seed.chain();
    const prod = (await clone.pool.query<{ id: string }>(`INSERT INTO catalog.productions (promoter_id, title) VALUES ($1,'Inscenace') RETURNING id`, [src.promoterId])).rows[0].id;
    await clone.pool.query(`UPDATE catalog.events SET production_id=$2, allow_self_service_exchange=true WHERE id=$1`, [src.eventId, prod]);
    tgtEventId = (await clone.pool.query<{ id: string }>(
      `INSERT INTO catalog.events (organizer_id, promoter_id, venue_id, title, slug, status, currency, event_type, date_start, production_id, allow_self_service_exchange)
       VALUES ($1,$1,$2,'Repríza',$3,'published','CZK','concert',NOW()+INTERVAL '40 days',$4,true) RETURNING id`,
      [src.promoterId, src.venueId, `repriza-${Date.now()}`, prod])).rows[0].id;
    tgtTypeId = (await clone.pool.query<{ id: string }>(
      `INSERT INTO catalog.ticket_types (event_id, name, kind, base_price, total_qty, remaining_qty, visibility)
       VALUES ($1,'Standard','standing',10000,50,50,'public') RETURNING id`, [tgtEventId])).rows[0].id;
    const o = await clone.seed.order(src, { quantity: 2 });
    // seed.order kapacitu nesnižuje — jako skutečný prodej (checkout) odečteme 2 kusy.
    await clone.pool.query(`UPDATE catalog.ticket_types SET remaining_qty = remaining_qty - 2 WHERE id=$1`, [src.ticketTypeId]);
    orderId = o.orderId;
    await clone.seed.tickets(o.orderId);
    tickets = (await clone.pool.query<{ id: string }>(`SELECT id FROM tickets.tickets WHERE order_id=$1 ORDER BY id`, [o.orderId])).rows.map((r) => r.id);
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [o.userId])).rows[0].email;
    const { signAccessToken } = await import('@/lib/auth');
    tok = await signAccessToken({ id: o.userId, email, name: 'E' } as never, { isPlatformAdmin: false, promoterMemberships: [] } as never);
  }, 180_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const eventOf = async (ticketId: string) => (await clone.pool.query<{ event_id: string; ticket_type_id: string }>(
    `SELECT o.event_id, t.ticket_type_id FROM tickets.tickets t JOIN orders.orders o ON o.id = t.order_id WHERE t.id=$1`, [ticketId])).rows[0];
  const remaining = async (tt: string) => (await clone.pool.query(`SELECT remaining_qty FROM catalog.ticket_types WHERE id=$1`, [tt])).rows[0].remaining_qty as number;

  it('vymění jen jednu vstupenku ze dvou', async () => {
    expect(tickets).toHaveLength(2);
    const [moved, stays] = tickets;
    const srcBefore = await remaining(src.ticketTypeId);
    const tgtBefore = await remaining(tgtTypeId);
    const { POST } = await import('@/app/api/buyer/tickets/[ticketId]/exchange/route');
    const r = await throughMiddleware(new Request(`http://localhost/api/buyer/tickets/${moved}/exchange`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
      body: JSON.stringify({ targetEventId: tgtEventId }),
    }), POST as unknown as H, { params: { ticketId: moved } });
    expect(r.status, await r.clone().text()).toBe(200);

    const m = await eventOf(moved);
    const s = await eventOf(stays);
    console.log('[3e]', JSON.stringify({ moved: m, stays: s }));
    expect(m.event_id).toBe(tgtEventId);
    expect(m.ticket_type_id).toBe(tgtTypeId);
    expect(s.event_id).toBe(src.eventId);
    expect(s.ticket_type_id).toBe(src.ticketTypeId);
    expect((await clone.pool.query(`SELECT event_id FROM orders.orders WHERE id=$1`, [orderId])).rows[0].event_id).toBe(src.eventId);
    expect(await remaining(tgtTypeId)).toBe(tgtBefore - 1);
    expect(await remaining(src.ticketTypeId)).toBe(srcBefore + 1);
  });

  it('jediná vstupenka v objednávce: přepne se objednávka i typ lístku', async () => {
    const o = await clone.seed.order(src, { quantity: 1 });
    await clone.pool.query(`UPDATE catalog.ticket_types SET remaining_qty = remaining_qty - 1 WHERE id=$1`, [src.ticketTypeId]);
    await clone.seed.tickets(o.orderId);
    const t = (await clone.pool.query<{ id: string }>(`SELECT id FROM tickets.tickets WHERE order_id=$1`, [o.orderId])).rows[0].id;
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [o.userId])).rows[0].email;
    const { signAccessToken } = await import('@/lib/auth');
    const t2 = await signAccessToken({ id: o.userId, email, name: 'E' } as never, { isPlatformAdmin: false, promoterMemberships: [] } as never);
    const { POST } = await import('@/app/api/buyer/tickets/[ticketId]/exchange/route');
    const r = await throughMiddleware(new Request(`http://localhost/api/buyer/tickets/${t}/exchange`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t2}` },
      body: JSON.stringify({ targetEventId: tgtEventId }),
    }), POST as unknown as H, { params: { ticketId: t } });
    expect(r.status, await r.clone().text()).toBe(200);
    expect(await eventOf(t)).toEqual({ event_id: tgtEventId, ticket_type_id: tgtTypeId });
    expect((await clone.pool.query(`SELECT ticket_type_id FROM orders.order_items WHERE order_id=$1`, [o.orderId])).rows[0].ticket_type_id).toBe(tgtTypeId);
  });
});
