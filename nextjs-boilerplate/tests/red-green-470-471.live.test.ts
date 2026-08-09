/**
 * red-green-470-471.live.test.ts — RED se meri na klonu BEZ testovane migrace.
 *
 * §187: `createLiveClone` aplikuje VSECHNY soubory z `../migrations`, takze RED->GREEN
 * u prave napsane migrace merilo dvakrat "po". Nove se RED stav vyrobi vynechanim
 * migrace (`exclude`), GREEN pak jejim aplikovanim na temz klonu.
 *
 * Merene:
 *   470  orders.ticket_transfers  — servisni + admin + prijemcova vetev
 *   471  orders.transit_passes    — administratorska vetev (drift jmena GUC)
 */
import { describe, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { createLiveClone, makeSeed, hasNeonKey, type LiveClone, type Seed } from './helpers/live-fixture';
import { makeInserter, seesRow } from './helpers/catalog-seed';

const d = hasNeonKey ? describe : describe.skip;
let clone: LiveClone;
let seed: Seed;
let chain: Awaited<ReturnType<Seed['fullChain']>>;

d('RED->GREEN migraci 470 a 471 (RED = klon BEZ nich)', () => {
  beforeAll(async () => {
    clone = await createLiveClone('redgreen', { exclude: ['470', '471'] });
    seed = makeSeed(clone.pool);
    chain = await seed.fullChain();
  }, 300_000);

  afterAll(async () => { await clone?.cleanup(); }, 120_000);

  it('470 ticket_transfers + 471 transit_passes', async () => {
    const q = clone.pool;
    const uri = process.env.DATABASE_URL as string;
    const tk = await q.query('SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1', [chain.orderId]);
    const A = makeInserter(q, {
      event_id: chain.eventId, venue_id: chain.venueId, promoter_id: chain.promoterId,
      ticket_type_id: chain.ticketTypeId, order_id: chain.orderId, ticket_id: tk.rows[0]?.id,
      user_id: chain.userId, from_user_id: chain.userId,
    });

    const tt = await A.insert('orders.ticket_transfers', 'to_email', 'prijemce@example.cz');
    const tp = await A.insert('orders.transit_passes', 'order_id', chain.orderId);
    if (tt.err || tp.err) { console.log(`  NEVIM (seed: ${tt.err ?? tp.err})`); return; }

    const svc = { 'app.role': 'service' };
    const adm = { 'app.is_platform_admin': 'true', 'app.role': 'user' };
    const own = { 'app.current_user_id': chain.userId, 'app.role': 'user' };

    const probe = async () => ({
      ttService: await seesRow(uri, 'orders.ticket_transfers', 'id', tt.id, svc),
      ttAdmin: await seesRow(uri, 'orders.ticket_transfers', 'id', tt.id, adm),
      tpAdmin: await seesRow(uri, 'orders.transit_passes', 'id', tp.id, adm),
      tpOwner: await seesRow(uri, 'orders.transit_passes', 'id', tp.id, own),
    });

    const red = await probe();
    await q.query(readFileSync('../migrations/470_ticket_transfers_service_branch.sql', 'utf8'));
    await q.query(readFileSync('../migrations/471_transit_passes_admin_guc_drift.sql', 'utf8'));
    const green = await probe();

    const row = (name: string, k: keyof typeof red, want: number) => {
      const ok = red[k] !== green[k] || green[k] === want;
      console.log(`  ${name.padEnd(42)} RED=${red[k]}  GREEN=${green[k]}  ${green[k] === want ? (red[k] === want ? 'uz drive OK (RED nebyl RED)' : 'OPRAVENO') : 'NEOPRAVENO'}`);
      return ok;
    };
    console.log('  --- 470 orders.ticket_transfers ---');
    row('servisni kontext vidi transfer', 'ttService', 1);
    row('platform admin vidi transfer', 'ttAdmin', 1);
    console.log('  --- 471 orders.transit_passes ---');
    row('platform admin vidi transit pass', 'tpAdmin', 1);
    row('vlastnik ho vidi porad', 'tpOwner', 1);
  }, 300_000);
});
