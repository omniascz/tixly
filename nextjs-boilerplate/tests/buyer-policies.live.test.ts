/**
 * buyer-policies.live.test.ts — 93 buyer-only policies, jeden reprezentant na VZOR.
 *
 * Buyer byl dlouho slepa dimenze (§107): vsechno se merilo pod promoterem, a kdyz
 * se buyer poprve zmeril, nasel rozbite socialni funkce. Tenhle test bere policies,
 * ktere koreluji NA UZIVATELE a vubec ne na promotera (93 z 596), roztridi je podle
 * tvaru predikatu (19 vzorcu) a zmeri jeden reprezentant z kazdeho.
 *
 * POZOR na artefakt ze §183: "vlastni nevidi" byva NEUPLNY SEED, ne nalez. Proto se
 * seed odvozuje z KATALOGU (NOT NULL, CHECK vycty, FK cile, PK sloupec) a kdyz retez
 * dostavet nejde, hlasi se NEVIM — nikdy "rozbite".
 */
import { describe, it, beforeAll, afterAll } from 'vitest';
import { createLiveClone, makeSeed, hasNeonKey, type LiveClone, type Seed } from './helpers/live-fixture';
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

const d = hasNeonKey ? describe : describe.skip;
let clone: LiveClone;
let seed: Seed;
let chain: Awaited<ReturnType<Seed['fullChain']>>;
let uB: { id: string };

/** [tvar, tabulka, policy, korelacni sloupec na TETO tabulce] */
const REPR: Array<[number, string, string, string]> = [
  [1, 'auth.passkey_challenges', 'p_rls_passkey_challenges', 'user_id'],
  [2, 'compliance.dsa_reports', 'dsa_reports_own', 'reporter_user_id'],
  [3, 'identity.user_secrets', 'p_user_secrets_scope', 'user_id'],
  [4, 'identity.oauth_accounts', 'p_oauth_accounts_owner_read', 'user_id'],
  [5, 'orders.postal_deliveries', 'postal_deliveries_buyer', 'order_id'],
  [6, 'marketing.loyalty_transactions', 'loyalty_tx_owner', 'account_id'],
  [7, 'marketing.user_spotify_connections', 'p_spotify_conn_own', 'user_id'],
  [8, 'orders.identity_verifications', 'identity_verif_own_select', 'user_id'],
  [9, 'catalog.scanner_devices', 'platform_admin_devices', '(zadny — jen admin)'],
  [10, 'identity.eudi_verifications', 'p_eudi_verifications_scope', 'user_id'],
  [11, 'identity.magic_link_tokens', 'magic_link_tokens_owner', 'user_id'],
  [12, 'identity.oauth_accounts', 'oauth_accounts_own', 'user_id'],
  [13, 'lineups.artist_follows', 'artist_follows_own', 'user_id'],
  [14, 'marketing.ticket_alerts', 'ticket_alerts_select', 'user_id'],
  [15, 'orders.party_split_slots', 'party_split_slots_write', 'session_id'],
  [16, 'orders.ticket_transfers', 'p_ticket_transfers_service', 'to_email'],
  [17, 'orders.ticket_transfers', 'ticket_transfers_sender', 'from_user_id'],
  [18, 'orders.transit_passes', 'transit_passes_buyer_owns', 'order_id'],
  [19, 'resale.resale_listings', 'resale_listings_buyer_view', 'seller_id'],
];

/** Genericky seeder rizeny KATALOGEM — ne odhadem. */
function makeInserter(q: Pool, known: Record<string, unknown>) {
  const pkCache = new Map<string, string>();

  const pkCol = async (tbl: string) => {
    if (pkCache.has(tbl)) return pkCache.get(tbl)!;
    const r = await q.query<{ c: string }>(
      `SELECT a.attname AS c FROM pg_index i
         JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid=$1::regclass AND i.indisprimary`, [tbl]);
    const c = r.rows.length === 1 ? r.rows[0].c : 'ctid';
    pkCache.set(tbl, c);
    return c;
  };

  /** CHECK (col = ANY (ARRAY['a','b'])) -> col => 'a' */
  const checkValues = async (tbl: string) => {
    const r = await q.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid=$1::regclass AND contype='c'`, [tbl]);
    const out = new Map<string, string | number>();
    for (const row of r.rows) {
      const m = /\(?([a-z_]+)\)?\s*=\s*ANY\s*\(ARRAY\[(.+?)\]\)/is.exec(row.def);
      if (m) {
        const first = /'([^']*)'/.exec(m[2]);
        if (first) out.set(m[1], first[1]);
        continue;
      }
      // ciselna mez: `total_slots >= 2` — jednicka by CHECK porusila
      const n = /\(?([a-z_]+)\)?\s*>=\s*(\d+)/.exec(row.def);
      // >= 0 nestaci: vedle byva `> 0`. Minimum posouvame na 1, kdyz to mez dovoli.
      if (n) out.set(n[1], Math.max(Number(n[2]), 1));
    }
    return out;
  };

  const fkTargets = async (tbl: string) => {
    const r = await q.query<{ col: string; tgt: string }>(
      `SELECT a.attname AS col, c.confrelid::regclass::text AS tgt
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
        WHERE c.conrelid=$1::regclass AND c.contype='f' AND array_length(c.conkey,1)=1`, [tbl]);
    return new Map(r.rows.map((x) => [x.col, x.tgt]));
  };

  const insert = async (
    tbl: string, corr: string | null, val: unknown, depth = 0,
  ): Promise<{ id?: unknown; err?: string }> => {
    const meta = await q.query<{ attname: string; typ: string; notnull: boolean; hasdef: boolean }>(
      `SELECT a.attname, format_type(a.atttypid,a.atttypmod) AS typ, a.attnotnull AS notnull,
              (d.adrelid IS NOT NULL) AS hasdef
         FROM pg_attribute a
         LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped`, [tbl]);
    const checks = await checkValues(tbl);
    const fks = await fkTargets(tbl);
    const cols: string[] = []; const vals: unknown[] = [];

    for (const c of meta.rows.filter((x) => x.notnull && !x.hasdef)) {
      if (corr && c.attname === corr) { cols.push(corr); vals.push(val); continue; }
      if (known[c.attname] !== undefined) { cols.push(c.attname); vals.push(known[c.attname]); continue; }
      if (checks.has(c.attname)) { cols.push(c.attname); vals.push(checks.get(c.attname)); continue; }
      const tgt = fks.get(c.attname);
      if (tgt) {
        const pk = await pkCol(tgt);
        let ex = await q.query(`SELECT ${pk} AS id FROM ${tgt} LIMIT 1`);
        if (!ex.rowCount && depth < 1) {
          const made = await insert(tgt, null, null, depth + 1);
          if (made.err) return { err: `FK ${c.attname}->${tgt}: ${made.err}` };
          ex = await q.query(`SELECT ${pk} AS id FROM ${tgt} LIMIT 1`);
        }
        if (!ex.rowCount) return { err: `FK ${c.attname}->${tgt} prazdna` };
        cols.push(c.attname); vals.push(ex.rows[0].id); continue;
      }
      if (c.typ === 'uuid') return { err: `neresitelny uuid: ${c.attname}` };
      if (/int|numeric|bigint|double|real/.test(c.typ)) vals.push(1);
      else if (/timestamp|date/.test(c.typ)) vals.push(new Date().toISOString());
      else if (c.typ === 'boolean') vals.push(false);
      else if (/jsonb?/.test(c.typ)) vals.push('{}');
      else if (/\[\]$/.test(c.typ)) vals.push('{}');
      else if (/text|character|citext/.test(c.typ)) vals.push(`x${randomUUID().slice(0, 8)}`);
      else if (/bytea/.test(c.typ)) vals.push(Buffer.from('x'));
      else return { err: `neznamy typ ${c.typ} (${c.attname})` };
      cols.push(c.attname);
    }
    // korelacni sloupec doplnit i kdyz je nullable — bez nej se izolace nezmeri
    if (corr && !cols.includes(corr) && meta.rows.some((c) => c.attname === corr)) {
      cols.push(corr); vals.push(val);
    }
    const pk = await pkCol(tbl);
    try {
      const r = await q.query(
        `INSERT INTO ${tbl} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING ${pk}`,
        vals);
      return { id: r.rows[0][pk] };
    } catch (e) {
      const err = e as { code?: string; message?: string };
      // Kdyz je korelacni sloupec zaroven PK (user_secrets: PK = user_id), radek uz
      // muze existovat z fullChain. To neni chyba seedu — pouzij ten existujici.
      if (err.code === '23505' && corr === pk) {
        const ex = await q.query(`SELECT ${pk} AS id FROM ${tbl} WHERE ${pk}=$1`, [val]);
        if (ex.rowCount) return { id: ex.rows[0].id };
      }
      return { err: `${err.code} ${err.message?.slice(0, 70)}` };
    }
  };
  return { insert, pkCol };
}

d('93 buyer-only policies — jeden reprezentant na vzor', () => {
  beforeAll(async () => {
    clone = await createLiveClone('buyerpol');
    seed = makeSeed(clone.pool);
    chain = await seed.fullChain();
    uB = await seed.user('cizi');
  }, 300_000);

  afterAll(async () => { await clone?.cleanup(); }, 120_000);

  it('buyer vidi sve, nevidi cizi', async () => {
    const q = clone.pool;
    const emailA = (await q.query('SELECT email FROM identity.users WHERE id=$1', [chain.userId])).rows[0].email as string;
    const emailB = (await q.query('SELECT email FROM identity.users WHERE id=$1', [uB.id])).rows[0].email as string;
    const tk = await q.query('SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1', [chain.orderId]);

    const knownA: Record<string, unknown> = {
      event_id: chain.eventId, venue_id: chain.venueId, promoter_id: chain.promoterId,
      ticket_type_id: chain.ticketTypeId, order_id: chain.orderId, ticket_id: tk.rows[0]?.id,
      user_id: chain.userId, seller_id: chain.userId, from_user_id: chain.userId,
      reporter_user_id: chain.userId, organizer_user_id: chain.userId,
    };
    const A = makeInserter(q, knownA);

    // ── korelacni retezy pro CIZIHO uzivatele (B) ────────────────────────────
    const orderB = await A.insert('orders.orders', 'user_id', uB.id);
    const knownB: Record<string, unknown> = {
      ...knownA, user_id: uB.id, seller_id: uB.id, from_user_id: uB.id,
      reporter_user_id: uB.id, organizer_user_id: uB.id,
      ...(orderB.id ? { order_id: orderB.id } : {}),
    };
    const B = makeInserter(q, knownB);

    const loyA = await A.insert('marketing.loyalty_accounts', 'user_id', chain.userId);
    const loyB = await B.insert('marketing.loyalty_accounts', 'user_id', uB.id);
    const psA = await A.insert('orders.party_split_sessions', 'organizer_user_id', chain.userId);
    const psB = await B.insert('orders.party_split_sessions', 'organizer_user_id', uB.id);

    /** hodnota korelacniho sloupce pro vlastnika (A) a ciziho (B) */
    const corrVal: Record<string, [unknown, unknown] | string> = {
      user_id: [chain.userId, uB.id],
      reporter_user_id: [chain.userId, uB.id],
      from_user_id: [chain.userId, uB.id],
      seller_id: [chain.userId, uB.id],
      to_email: [emailA, emailB],
      order_id: orderB.id ? [chain.orderId, orderB.id] : `orders.orders: ${orderB.err}`,
      account_id: loyA.id && loyB.id ? [loyA.id, loyB.id] : `loyalty_accounts: ${loyA.err ?? loyB.err}`,
      session_id: psA.id && psB.id ? [psA.id, psB.id] : `party_split_sessions: ${psA.err ?? psB.err}`,
    };

    const { Client } = await import('pg');
    const ask = async (tbl: string, pk: string, id: unknown, asUser?: string, admin = false) => {
      const a = new Client({ connectionString: process.env.DATABASE_URL });
      await a.connect();
      // SET LOCAL v transakci, ne holy SET: holy SET prezije spojeni a pri jeho
      // recyklaci prosakne do dalsiho mereni (zmereno — `app.is_platform_admin`
      // zustalo 'true' na cerstvem klientovi). Je to tataz pricina jako R-15.
      await a.query('BEGIN');
      await a.query(`SET LOCAL app.current_user_id='${asUser ?? chain.userId}'`);
      await a.query("SET LOCAL app.role='user'");
      if (admin) await a.query("SET LOCAL app.is_platform_admin='true'");
      const r = await a.query(`SELECT count(*)::int n FROM ${tbl} WHERE ${pk}=$1`, [id]);
      await a.query('COMMIT');
      await a.end();
      return r.rows[0].n as number;
    };

    let ok = 0, leak = 0, unknownN = 0, broken = 0;
    for (const [shape, tbl, pol, corr] of REPR) {
      const label = `${String(shape).padStart(2)}. ${tbl}.${pol}`;
      if (corr.startsWith('(')) {
        // Predikat neni o vlastnictvi, ale o tom, jestli je uzivatel admin. Merime
        // tedy jinou dvojici: bezny buyer NEVIDI, platform admin VIDI.
        const dev = await A.insert(tbl, null, null);
        if (dev.err) { console.log(`  ${label.padEnd(62)} NEVIM (seed: ${dev.err})`); unknownN++; continue; }
        const pk9 = await A.pkCol(tbl);
        const asBuyer = await ask(tbl, pk9, dev.id);
        await q.query('UPDATE identity.users SET is_platform_admin=true WHERE id=$1', [uB.id]);
        const asAdmin = await ask(tbl, pk9, dev.id, uB.id);
        await q.query('UPDATE identity.users SET is_platform_admin=false WHERE id=$1', [uB.id]);
        const v9 = asBuyer === 0 && asAdmin === 1 ? 'OK' : asBuyer === 1 ? 'UNIK — bezny buyer vidi' : 'admin NEVIDI';
        if (v9 === 'OK') ok++; else if (v9.startsWith('UNIK')) leak++; else broken++;
        console.log(`  ${label.padEnd(62)} buyer=${asBuyer} admin=${asAdmin}  ${v9}`);
        continue;
      }
      const pair = corrVal[corr];
      if (typeof pair === 'string') { console.log(`  ${label.padEnd(62)} NEVIM (${pair})`); unknownN++; continue; }
      const a = await A.insert(tbl, corr, pair[0]);
      const b = await B.insert(tbl, corr, pair[1]);
      if (a.err || b.err) { console.log(`  ${label.padEnd(62)} NEVIM (seed: ${a.err ?? b.err})`); unknownN++; continue; }
      // resale_listings ma prvni vetev `status = 'active'` — verejny marketplace.
      // Radek s defaultnim status='active' vidi kazdy ZAMERNE, takze by "vidi cizi"
      // byl artefakt seedu (§183 naruby). Merime cizi radek mimo tenhle stav.
      if (tbl === 'resale.resale_listings') await q.query(`UPDATE ${tbl} SET status='expired' WHERE id=$1`, [b.id]);
      const pk = await A.pkCol(tbl);
      const sees = await ask(tbl, pk, a.id);
      const seesForeign = await ask(tbl, pk, b.id);
      const verdict = sees === 1 && seesForeign === 0 ? 'OK'
        : seesForeign === 1 ? 'UNIK — vidi cizi'
        : 'vlastni NEVIDI';
      if (verdict === 'OK') ok++; else if (verdict.startsWith('UNIK')) leak++; else broken++;
      console.log(`  ${label.padEnd(62)} sve=${sees} cizi=${seesForeign}  ${verdict}`);
    }
    // R-53: transit_passes — dokazat, ze migrace 471 ozivi admin vetev (§108)
    // radky uz zalozil vzor 18 (order_id je UNIQUE) — pouzij je, nezakladej znovu
    const tp = { id: (await q.query('SELECT id FROM orders.transit_passes WHERE order_id=$1', [chain.orderId])).rows[0]?.id, err: undefined as string | undefined };
    const tpB = { id: (await q.query('SELECT id FROM orders.transit_passes WHERE order_id=$1', [orderB.id])).rows[0]?.id, err: undefined as string | undefined };
    if (tp.id && tpB.id) {
      await q.query('UPDATE identity.users SET is_platform_admin=true WHERE id=$1', [uB.id]);
      // Klon aplikuje VSECHNY soubory z ../migrations vcetne 471, takze "pred"
      // stav neexistuje sam od sebe — musi se obnovit puvodni text policy.
      await q.query('DROP POLICY IF EXISTS transit_passes_buyer_owns ON orders.transit_passes');
      await q.query(`CREATE POLICY transit_passes_buyer_owns ON orders.transit_passes USING (
        (order_id IN (SELECT o.id FROM orders.orders o WHERE o.user_id = app_current_user_id()))
        OR (current_setting('app.platform_admin', true) = 'true'))`);
      const adminPred = await ask('orders.transit_passes', 'id', tp.id, uB.id, true);
      const { readFileSync } = await import('fs');
      await q.query(readFileSync('../migrations/471_transit_passes_admin_guc_drift.sql', 'utf8'));
      const adminPo = await ask('orders.transit_passes', 'id', tp.id, uB.id, true);
      await q.query('UPDATE identity.users SET is_platform_admin=false WHERE id=$1', [uB.id]);
      const buyerOwn = await ask('orders.transit_passes', 'id', tp.id);
      const buyerCizi = await ask('orders.transit_passes', 'id', tpB.id);
      const diag = new Client({ connectionString: process.env.DATABASE_URL });
      await diag.connect();
      await diag.query(`SET app.current_user_id='${chain.userId}'`);
      await diag.query("SET app.role='user'");
      const d1 = await diag.query('SELECT app_is_platform_admin() a, app_current_user_id()::text u, current_setting($1,true) g', ['app.is_platform_admin']);
      const d2 = await diag.query('SELECT count(*)::int n FROM orders.orders WHERE user_id=$1', [uB.id]);
      const d3 = await diag.query(`SELECT relrowsecurity r, relforcerowsecurity f FROM pg_class WHERE oid='orders.transit_passes'::regclass`);
      const d4 = await diag.query(`SELECT policyname, qual FROM pg_policies WHERE tablename='transit_passes'`);
      const d5 = await diag.query('SELECT current_user cu');
      await diag.end();
      console.log(`  R-53 transit_passes: admin PRED mig471=${adminPred}  PO=${adminPo}   | buyer sve=${buyerOwn} cizi=${buyerCizi}`);
      console.log('  DIAG', JSON.stringify(d1.rows[0]), 'cizich orders videt:', d2.rows[0].n, JSON.stringify(d3.rows[0]), JSON.stringify(d5.rows[0]));
      d4.rows.forEach((x) => console.log('  POL', x.policyname, String(x.qual).slice(0, 120)));
    } else {
      console.log('  R-53 transit_passes: NEVIM (radky ze vzoru 18 se nenasly)');
    }

    console.log(`\n  SOUHRN vzorcu: OK=${ok}  UNIK=${leak}  ROZBITE=${broken}  NEVIM=${unknownN}  z ${REPR.length}`);
  }, 600_000);
});
