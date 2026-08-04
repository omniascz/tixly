#!/usr/bin/env node
/**
 * test-456-tokens.mjs — RED/GREEN pro tri mrtve tabulky (base64url).
 *
 * Reprodukuje presne ty INSERTy, ktere delaji route handlery po oprave,
 * a PEELuje vrstvy: kazda cesta se dojede az do PROSLO, nebo se zapise
 * blocker, ktery chce produktove rozhodnuti.
 *
 *   NEON_API_KEY=... node scripts/test-456-tokens.mjs clone.json
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';

const clone = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const o = new pg.Client({ connectionString: clone.ownerUri, statement_timeout: 0 });
await o.connect();

// ── seed retezce ────────────────────────────────────────────────────────────
const U = randomUUID(), P = randomUUID(), V = randomUUID(), E = randomUUID();
const TT = randomUUID(), ORD = randomUUID(), TK = randomUUID();
await o.query(`INSERT INTO identity.users (id,email,name,gdpr_consent_at) VALUES ($1,$2,'U',now())`, [U, `u_${U.slice(0,8)}@t.cz`]);
await o.query(`INSERT INTO platform.promoters (id,name,email) VALUES ($1,'P',$2)`, [P, `p_${P.slice(0,8)}@t.cz`]);
await o.query(`INSERT INTO catalog.venues (id,name,city,country,capacity) VALUES ($1,'V','Praha','CZ',100)`, [V]);
await o.query(`INSERT INTO catalog.events (id,promoter_id,organizer_id,venue_id,title,date_start,slug)
  VALUES ($1,$2,$3,$4,'E',now()+interval '30 day',$5)`, [E, P, U, V, 'ev-' + E.slice(0, 8)]);
await o.query(`INSERT INTO catalog.ticket_types (id,event_id,name,kind,base_price,total_qty,remaining_qty)
  VALUES ($1,$2,'TT','standing',500,100,100)`, [TT, E]);
await o.query(`INSERT INTO orders.orders (id,user_id,event_id,total_amount,expires_at)
  VALUES ($1,$2,$3,500,now()+interval '1 day')`, [ORD, U, E]);
await o.query(`INSERT INTO tickets.tickets (id,order_id,ticket_type_id,owner_id,original_owner_id,
  totp_secret_encrypted,totp_secret_iv,original_price)
  VALUES ($1,$2,$3,$4,$4,decode('00','hex'),decode('00','hex'),500)`, [TK, ORD, TT, U]);
console.log('── seed hotov ──');

const CASES = [
  ['ticket_alerts (hlídací pes)', async () => {
    const t = randomBytes(16).toString('base64url');
    const r = await o.query(
      `INSERT INTO marketing.ticket_alerts (email, event_id, user_id, alert_type, token)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (email, event_id, alert_type) DO UPDATE SET cancelled_at = NULL
       RETURNING token`, [`a_${randomUUID().slice(0,8)}@t.cz`, E, U, 'on_sale', t]);
    return r.rows[0].token;
  }],
  ['party_split_sessions (rozdělení platby)', async () => {
    const r = await o.query(
      `INSERT INTO orders.party_split_sessions
         (event_id, ticket_type_id, organizer_user_id, organizer_email, organizer_name,
          total_slots, per_slot_amount, currency, share_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING share_token`,
      [E, TT, U, `o_${randomUUID().slice(0,8)}@t.cz`, 'Org', 3, 500, 'CZK',
       randomBytes(18).toString('base64url')]);
    return r.rows[0].share_token;
  }],
  ['ticket_transfers (P2P převod)', async () => {
    const r = await o.query(
      `INSERT INTO orders.ticket_transfers (ticket_id, order_id, from_user_id, to_email, transfer_token)
       VALUES ($1,$2,$3,$4,$5) RETURNING transfer_token`,
      [TK, ORD, U, `to_${randomUUID().slice(0,8)}@t.cz`, randomBytes(24).toString('base64url')]);
    return r.rows[0].transfer_token;
  }],
];

let ok = 0;
for (const [name, fn] of CASES) {
  try {
    const tok = await fn();
    const urlSafe = /^[A-Za-z0-9_-]+$/.test(tok);
    console.log(`✅ ${name.padEnd(42)} token=${tok.slice(0, 12)}… (${tok.length} zn.) URL-safe=${urlSafe ? 'ano' : 'NE 🔴'}`);
    if (urlSafe) ok++;
  } catch (e) {
    console.log(`🔴 ${name.padEnd(42)} ${e.code} ${(e.message || '').slice(0, 110)}`);
  }
}
await o.end();
console.log(`\n═══ ${ok}/${CASES.length} cest PROŠLO ═══`);
process.exit(ok === CASES.length ? 0 : 1);
