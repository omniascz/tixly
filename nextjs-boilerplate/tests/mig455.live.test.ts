/**
 * mig455.live.test.ts — chovanim overit policies z migrace 455.
 *
 * Prevod textove sedi u vsech 20, chovanim byly overene 3. Tenhle test seeduje
 * radek do kazde dotcene tabulky (NOT NULL sloupce se odvozuji INTROSPEKCI,
 * FK se resi proti fullChain) a pak meri dve veci:
 *   vlastni kontext  -> radek VIDI
 *   cizi kontext     -> radek NEVIDI
 * Kde je FK/CHECK retez moc dlouhy na automaticky seed, hlasi se NEVIM.
 */
import { describe, it, beforeAll, afterAll } from 'vitest';
import { createLiveClone, makeSeed, hasNeonKey, type LiveClone, type Seed } from './helpers/live-fixture';
import { randomUUID } from 'crypto';

const d = hasNeonKey ? describe : describe.skip;
let clone: LiveClone;
let seed: Seed;
let chain: Awaited<ReturnType<Seed['fullChain']>>;
let uB: { id: string }; let pB: string; let weroPaymentId: string | undefined;

const TABLES: Array<[string, 'promoter' | 'user']> = [
  ['catalog.event_distribution_partners', 'promoter'],
  ['catalog.event_sponsors', 'promoter'],
  ['catalog.event_travel_links', 'promoter'],
  ['catalog.event_travel_packages', 'promoter'],
  ['catalog.venue_gates', 'promoter'],
  ['identity.magic_link_tokens', 'user'],
  ['lineups.performance_cast', 'promoter'],
  ['marketing.ticket_alerts', 'user'],
  ['orders.box_office_sales', 'promoter'],
  ['orders.box_office_sessions', 'promoter'],
  ['orders.postal_deliveries', 'user'],
  ['orders.seat_upgrades', 'user'],
  ['orders.ticket_transfers', 'user'],
  ['orders.travel_bookings', 'user'],
  ['payments.wero_payments', 'promoter'],
  ['payments.wero_webhooks', 'promoter'],
];

d('migrace 455 — chovani policies', () => {
  beforeAll(async () => {
    clone = await createLiveClone('mig455');
    seed = makeSeed(clone.pool);
    chain = await seed.fullChain();
    uB = await seed.user('cizi');
    const r = await clone.pool.query(
      "INSERT INTO platform.promoters (name,email) VALUES ('B',$1) RETURNING id",
      [`b_${randomUUID().slice(0, 8)}@t.cz`]);
    pB = r.rows[0].id as string;
    // venue_gates_select koreluje pres catalog.venues.promoter_id — fullChain
    // venue zaklada bez nej, takze by vlastnik svuj radek nevidel a vypadalo
    // by to jako nalez. Doplneno, aby se merila policy, ne mezera v seedu.
    await clone.pool.query('UPDATE catalog.venues SET promoter_id=$1 WHERE id=$2',
      [chain.promoterId, chain.venueId]);
    // wero_webhooks koreluje pres payment_id -> wero_payments.promoter_id (TEXT!)
    const wp = await clone.pool.query(
      `INSERT INTO payments.wero_payments (promoter_id, order_id) VALUES ($1, $2) RETURNING id`,
      [chain.promoterId, chain.orderId]).catch((e) => { console.log('wero seed:', e.code, e.message.slice(0, 70)); return null; });
    if (wp) weroPaymentId = wp.rows[0].id as string;
  }, 240_000);

  afterAll(async () => { await clone?.cleanup(); }, 120_000);

  it('vlastni vs cizi kontext na kazde tabulce z 455', async () => {
    const tk = await clone.pool.query('SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1', [chain.orderId]);
    const ticketId = tk.rows[0]?.id as string;
    // hodnoty, kterymi se plni FK podle jmena sloupce
    const known: Record<string, string> = {
      promoter_id: chain.promoterId, event_id: chain.eventId, venue_id: chain.venueId,
      ticket_type_id: chain.ticketTypeId, order_id: chain.orderId, ticket_id: ticketId,
      user_id: chain.userId, owner_id: chain.userId, from_user_id: chain.userId,
      ...(weroPaymentId ? { payment_id: weroPaymentId } : {}),
      buyer_user_id: chain.userId, created_by: chain.userId, organizer_id: chain.userId,
    };
    let ok = 0, leak = 0, unknown = 0;
    for (const [tbl, dim] of TABLES) {
      const meta = await clone.pool.query<{ attname: string; typ: string; notnull: boolean; hasdef: boolean }>(
        `SELECT a.attname, format_type(a.atttypid,a.atttypmod) AS typ, a.attnotnull AS notnull,
                (d.adrelid IS NOT NULL) AS hasdef
           FROM pg_attribute a
           LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
          WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped`, [tbl]);
      const need = meta.rows.filter((c) => c.notnull && !c.hasdef);
      const cols: string[] = []; const vals: unknown[] = []; const ph: string[] = [];
      let giveUp = false;
      for (const c of need) {
        let v: unknown;
        if (known[c.attname] !== undefined) v = known[c.attname];
        else if (c.typ === 'uuid') { giveUp = true; break; }
        else if (/int|numeric|bigint/.test(c.typ)) v = 1;
        else if (/timestamp|date/.test(c.typ)) v = new Date().toISOString();
        else if (c.typ === 'boolean') v = false;
        else if (/text|character/.test(c.typ)) v = 'x';
        else if (/jsonb?/.test(c.typ)) v = '{}';
        else { giveUp = true; break; }
        cols.push(c.attname); vals.push(v); ph.push(`$${ph.length + 1}`);
      }
      if (giveUp) { console.log(`  ${tbl.padEnd(38)} NEVIM (FK retez: neresitelny uuid sloupec)`); unknown++; continue; }
      // dopln tenant sloupec, i kdyz je nullable — bez nej se izolace nezmeri
      const tcol = dim === 'promoter' ? 'promoter_id' : 'user_id';
      const hasT = meta.rows.some((c) => c.attname === tcol);
      if (hasT && !cols.includes(tcol)) { cols.push(tcol); vals.push(known[tcol]); ph.push(`$${ph.length + 1}`); }
      let id: string | undefined;
      try {
        const r = await clone.pool.query(
          `INSERT INTO ${tbl} (${cols.join(',')}) VALUES (${ph.join(',')}) RETURNING id`, vals);
        id = r.rows[0]?.id as string;
      } catch (e) {
        console.log(`  ${tbl.padEnd(38)} NEVIM (seed ${(e as { code?: string }).code})`); unknown++; continue;
      }
      const { Client } = await import('pg');
      const ask = async (setup: string[]) => {
        const a = new Client({ connectionString: process.env.DATABASE_URL }); await a.connect();
        // SET LOCAL v transakci, ne holy SET (R-54): holy SET prezije spojeni a na
        // poolovanem endpointu se dostane k dalsimu mereni. Navic se tim uklidi GUC,
        // ktere tenhle kontext NENASTAVUJE — promoter-dimenze by jinak zdedila
        // `app.current_user_id` z predchozi user-dimenze a videla radek "spravne"
        // ze spatneho duvodu.
        await a.query('BEGIN');
        for (const s of setup) await a.query(s.replace(/^SET /, 'SET LOCAL '));
        const r = await a.query(`SELECT count(*)::int n FROM ${tbl} WHERE id=$1`, [id]);
        await a.query('COMMIT');
        await a.end(); return r.rows[0].n as number;
      };
      const own = dim === 'promoter'
        ? [`SET app.current_promoter_id='${chain.promoterId}'`, "SET app.role='promoter'"]
        : [`SET app.current_user_id='${chain.userId}'`, "SET app.role='user'"];
      const foreign = dim === 'promoter'
        ? [`SET app.current_promoter_id='${pB}'`, "SET app.role='promoter'"]
        : [`SET app.current_user_id='${uB.id}'`, "SET app.role='user'"];
      const a = await ask(own); const b = await ask(foreign);
      const verdict = a === 1 && b === 0 ? 'OK' : a === 0 ? 'vlastni NEVIDI' : 'CIZI VIDI';
      if (verdict === 'OK') ok++; else if (verdict === 'CIZI VIDI') leak++;
      console.log(`  ${tbl.padEnd(38)} [${dim}] vlastni=${a} cizi=${b}  ${verdict}`);
    }
    console.log(`\n  SOUHRN: OK=${ok}  UNIK=${leak}  NEVIM=${unknown}  z ${TABLES.length} tabulek`);
  }, 300_000);
});
