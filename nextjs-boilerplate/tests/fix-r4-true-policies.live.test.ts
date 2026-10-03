// @vitest-environment node
/**
 * Kolo 4 / krok 3b — RLS politiky s podmínkou `true` (migrace 491).
 *
 * Měří se pod tixly_app přes aplikační pool (runWith*Context), ne ručním SET:
 *  - zápis s `true` (ticket_alerts, postal_deliveries, travel_bookings, seat_upgrades,
 *    ticket_transfers) dovoloval kupci / anonymovi zapsat nebo změnit CIZÍ řádek;
 *  - čtení s `true` u superfan_experiences / event_travel_packages ukazovalo nabídky
 *    nepublikovaných akcí, u platform.promoters i neaktivní pořadatele (bankovní účet, KYC).
 * Plus regrese legitimních cest: upozornění (host, přihlášený, odhlášení tokenem).
 * (Převod vstupenky — samostatný nález, tests/fix-r4-transfer-claim.live.test.ts.)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;

run('Krok 3b (kolo 4) — politiky s podmínkou true', () => {
  let clone: LocalClone;
  let victim: Awaited<ReturnType<LocalClone['seed']['fullChain']>>;
  let attacker: { id: string; email: string };
  let rls: typeof import('@/lib/db/rls-pool');
  let tok: (u: { id: string; email: string }) => Promise<string>;

  beforeAll(async () => {
    clone = await createLocalClone();
    rls = await import('@/lib/db/rls-pool');
    victim = await clone.seed.fullChain();
    attacker = await clone.seed.user('utocnik');
    const { signAccessToken } = await import('@/lib/auth');
    tok = (u) => signAccessToken({ id: u.id, email: u.email, name: 'T' } as never, { isPlatformAdmin: false, promoterMemberships: [] } as never);
  }, 180_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  /** Vrátí počet zasažených řádků, nebo kód chyby (42501 = RLS odmítla). */
  const asUser = async (userId: string | null, sql: string, params: unknown[]) => {
    const exec = () => rls.db().query(sql, params);
    try {
      const r = userId ? await rls.runWithUserContext(userId, exec) : await exec();
      return r.rowCount ?? 0;
    } catch (e) { return (e as { code?: string }).code ?? String(e); }
  };
  const count = async (sql: string, params: unknown[]) => (await clone.pool.query(sql, params)).rows[0].n as number;

  it('zápis s true: kupec nezapíše/nezmění cizí řádek', async () => {
    const tkt = (await clone.pool.query(`SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1`, [victim.orderId])).rows[0].id;
    const res: Record<string, unknown> = {};
    res.alertInsertForeignUser = await asUser(null,
      `INSERT INTO marketing.ticket_alerts (email, event_id, user_id, alert_type, token) VALUES ('x@y.cz',$1,$2,'on_sale','t-${Date.now()}')`,
      [victim.eventId, victim.userId]);
    const alertTok = `a-${Date.now()}`;
    await clone.pool.query(`INSERT INTO marketing.ticket_alerts (email, event_id, user_id, alert_type, token) VALUES ('v@y.cz',$1,$2,'on_sale',$3)`, [victim.eventId, victim.userId, alertTok]);
    res.alertUpdateForeign = await asUser(attacker.id, `UPDATE marketing.ticket_alerts SET cancelled_at=now() WHERE token=$1`, [alertTok]);
    res.postalInsertForeign = await asUser(attacker.id,
      `INSERT INTO orders.postal_deliveries (order_id, recipient_name, address_line1, city, postal_code, country) VALUES ($1,'U','Ulice 1','Praha','11000','CZ')`, [victim.orderId]);
    res.seatUpgradeInsertForeign = await asUser(attacker.id,
      `INSERT INTO orders.seat_upgrades (original_order_id, original_ticket_id, upgrade_fee_halire, status) VALUES ($1,$2,0,'paid')`, [victim.orderId, tkt]);
    const su = (await clone.pool.query<{ id: string }>(`INSERT INTO orders.seat_upgrades (original_order_id, original_ticket_id, upgrade_fee_halire, status) VALUES ($1,$2,500,'pending') RETURNING id`, [victim.orderId, tkt])).rows[0].id;
    res.seatUpgradeUpdateForeign = await asUser(attacker.id, `UPDATE orders.seat_upgrades SET status='paid' WHERE id=$1`, [su]);
    const tr = (await clone.pool.query<{ id: string }>(
      `INSERT INTO orders.ticket_transfers (ticket_id, order_id, from_user_id, to_email, transfer_token, status, expires_at)
       VALUES ($1,$2,$3,'nekdo@jiny.cz',$4,'pending',now()+interval '1 day') RETURNING id`,
      [tkt, victim.orderId, victim.userId, `tt-${Date.now()}`])).rows[0].id;
    res.transferUpdateForeign = await asUser(attacker.id, `UPDATE orders.ticket_transfers SET to_email=$2 WHERE id=$1`, [tr, attacker.email]);
    const hotel = (await clone.pool.query<{ id: string }>(`INSERT INTO catalog.travel_hotels (name) VALUES ('Hotel') RETURNING id`)).rows[0].id;
    const room = (await clone.pool.query<{ id: string }>(`INSERT INTO catalog.travel_hotel_rooms (hotel_id, name, price_per_night_halire) VALUES ($1,'Pokoj',100) RETURNING id`, [hotel])).rows[0].id;
    const pkg = (await clone.pool.query<{ id: string }>(`INSERT INTO catalog.event_travel_packages (event_id, hotel_id, hotel_room_id, checkin_date, checkout_date) VALUES ($1,$2,$3,current_date,current_date+1) RETURNING id`, [victim.eventId, hotel, room])).rows[0].id;
    res.travelInsertForeign = await asUser(attacker.id,
      `INSERT INTO orders.travel_bookings (order_id, package_id, hotel_name, room_name, checkin_date, checkout_date, nights, price_per_night_halire, total_price_halire)
       VALUES ($1,$2,'H','P',current_date,current_date+1,1,100,100)`, [victim.orderId, pkg]);
    console.log('[3b zápis]', JSON.stringify(res));
    expect(res).toEqual({
      alertInsertForeignUser: '42501', alertUpdateForeign: 0, postalInsertForeign: '42501',
      seatUpgradeInsertForeign: '42501', seatUpgradeUpdateForeign: 0, transferUpdateForeign: 0, travelInsertForeign: '42501',
    });
    expect(await count(`SELECT count(*)::int AS n FROM orders.seat_upgrades WHERE id=$1 AND status='pending'`, [su])).toBe(1);
  });

  it('čtení: nabídky nepublikované akce a neaktivní pořadatel nejsou veřejně vidět; publikované/aktivní ano', async () => {
    const draft = await clone.seed.chain({ status: 'draft' });
    const pub = await clone.seed.chain();
    const sf = async (eventId: string) => (await clone.pool.query<{ id: string }>(
      `INSERT INTO catalog.superfan_experiences (event_id, name, type, capacity, price_halire) VALUES ($1,'Meet','meet_greet',10,1000) RETURNING id`, [eventId])).rows[0].id;
    const sfDraft = await sf(draft.eventId).catch(async (e) => { throw new Error(`seed superfan: ${(e as Error).message}`); });
    const sfPub = await sf(pub.eventId);
    await clone.pool.query(`UPDATE platform.promoters SET status='pending' WHERE id=$1`, [draft.promoterId]);
    await clone.pool.query(`UPDATE platform.promoters SET status='active' WHERE id=$1`, [pub.promoterId]);
    const see = async (sql: string, p: unknown[]) => asUser(null, sql, p);
    const res = {
      superfanDraft: await see(`SELECT 1 FROM catalog.superfan_experiences WHERE id=$1`, [sfDraft]),
      superfanPub: await see(`SELECT 1 FROM catalog.superfan_experiences WHERE id=$1`, [sfPub]),
      promoterPending: await see(`SELECT 1 FROM platform.promoters WHERE id=$1`, [draft.promoterId]),
      promoterActive: await see(`SELECT 1 FROM platform.promoters WHERE id=$1`, [pub.promoterId]),
      // vlastní pořadatel svůj koncept i sebe (pending) vidí
      superfanDraftOwner: await rls.runWithPromoterContext(draft.promoterId, () => rls.db().query(`SELECT 1 FROM catalog.superfan_experiences WHERE id=$1`, [sfDraft])).then((r) => r.rowCount),
      promoterPendingSelf: await rls.runWithPromoterContext(draft.promoterId, () => rls.db().query(`SELECT 1 FROM platform.promoters WHERE id=$1`, [draft.promoterId])).then((r) => r.rowCount),
      promoterPendingMember: await asUser(draft.adminUserId, `SELECT 1 FROM platform.promoters WHERE id=$1`, [draft.promoterId]),
    };
    console.log('[3b čtení]', JSON.stringify(res));
    expect(res).toEqual({ superfanDraft: 0, superfanPub: 1, promoterPending: 0, promoterActive: 1, superfanDraftOwner: 1, promoterPendingSelf: 1, promoterPendingMember: 1 });
  });

  it('regrese: upozornění host / přihlášený / odhlášení tokenem', async () => {
    const mod = (await import('@/app/api/events/[id]/alert/route')) as unknown as Record<string, H>;
    const ctx = { params: { id: victim.eventId } };
    const post = (h: Record<string, string>, email: string) => throughMiddleware(new Request(`http://localhost/api/events/${victim.eventId}/alert`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify({ email, alertType: 'on_sale' }),
    }), mod.POST, ctx);
    const g = await post({}, `host-${Date.now()}@tixly.test`);
    expect(g.status, await g.clone().text()).toBe(200);
    const token = ((await g.json()) as { token: string }).token;
    const a = await post({ authorization: `Bearer ${await tok(attacker)}` }, attacker.email);
    expect(a.status, await a.clone().text()).toBe(200);
    const row = (await clone.pool.query(`SELECT user_id FROM marketing.ticket_alerts WHERE email=$1 AND event_id=$2`, [attacker.email, victim.eventId])).rows[0];
    expect(row.user_id).toBe(attacker.id);
    const d = await throughMiddleware(new Request(`http://localhost/api/events/${victim.eventId}/alert?token=${token}`, { method: 'DELETE' }), mod.DELETE, ctx);
    expect(d.status).toBe(200);
    expect(await count(`SELECT count(*)::int AS n FROM marketing.ticket_alerts WHERE token=$1 AND cancelled_at IS NOT NULL`, [token])).toBe(1);
  });

});
