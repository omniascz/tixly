// E2E 07: PRIMY test RLS — pripojeni jako neprivilegovana role `tixly_app` (NOBYPASSRLS) k DB e2e
// (schema z migraci, data z predchozich E2E kroku) a pokus cist/zapisovat data JINEHO tenantu/uzivatele.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { q, owner, check, startLog, summary } from './lib.mjs';

startLog('07_rls_direct');
const S = JSON.parse(readFileSync(new URL(process.env.AUDIT_STATE ?? './state.json', import.meta.url), 'utf8'));
const app = new pg.Pool({ connectionString: process.env.AUDIT_APP_URL ?? 'postgresql://tixly_app:auditapp@localhost:55432/e2e', max: 2 });

/** Spusti fn v transakci s danym kontextem (SET LOCAL jako rls-pool.query()) a VZDY rollbackne. */
async function as(ctx, fn) {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    for (const [k, v] of Object.entries(ctx)) await c.query(`SELECT set_config($1, $2, true)`, [k, v]);
    return await fn(c);
  } finally { await c.query('ROLLBACK').catch(() => {}); c.release(); }
}
const n = async (c, sql, p) => { try { const r = await c.query(sql, p); return r.rows[0]?.n ?? r.rowCount; } catch (e) { await c.query('ROLLBACK').catch(() => {}); await c.query('BEGIN'); return `ERR ${e.code} ${e.message.slice(0, 70)}`; } };

const role = (await app.query(`SELECT current_user, (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS bypass, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS super`)).rows[0];
check('L0', 'pripojeni jako tixly_app: NOBYPASSRLS, ne superuser', role.current_user === 'tixly_app' && role.bypass === false && role.super === false, role);

const truth = (await q(`SELECT (SELECT count(*)::int FROM orders.orders) orders, (SELECT count(*)::int FROM tickets.tickets) tickets, (SELECT count(*)::int FROM identity.users) users, (SELECT count(*)::int FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id WHERE e.promoter_id=$1) orders_a`, [S.promoterA.id]))[0];

// ---- bez kontextu ----
const none = await as({}, async (c) => ({
  orders: await n(c, `SELECT count(*)::int n FROM orders.orders`), tickets: await n(c, `SELECT count(*)::int n FROM tickets.tickets`),
  users: await n(c, `SELECT count(*)::int n FROM identity.users`), user_secrets: await n(c, `SELECT count(*)::int n FROM identity.user_secrets`),
  payment_events: await n(c, `SELECT count(*)::int n FROM orders.payment_events`), promo_codes: await n(c, `SELECT count(*)::int n FROM marketing.promo_codes`),
}));
check('L1', 'BEZ kontextu: tixly_app nevidi zadne objednavky/vstupenky/uzivatele/hashe hesel/platby', ['orders', 'tickets', 'users', 'user_secrets', 'payment_events', 'promo_codes'].every((k) => none[k] === 0 || String(none[k]).startsWith('ERR 42501')), { groundTruthAsOwner: truth, seenAsTixlyApp: none });

// ---- kontext poradatele B -> data poradatele A ----
const B = { 'app.current_promoter_id': S.promoterB.id, 'app.role': 'promoter' };
const rb = await as(B, async (c) => ({
  ordersOfA: await n(c, `SELECT count(*)::int n FROM orders.orders o WHERE o.event_id=$1`, [S.eventA]),
  ticketsOfA: await n(c, `SELECT count(*)::int n FROM tickets.tickets t JOIN orders.orders o ON o.id=t.order_id WHERE o.event_id=$1`, [S.eventA]),
  orderItemsOfA: await n(c, `SELECT count(*)::int n FROM orders.order_items oi JOIN orders.orders o ON o.id=oi.order_id WHERE o.event_id=$1`, [S.eventA]),
  promoOfA: await n(c, `SELECT count(*)::int n FROM marketing.promo_codes WHERE upper(code)=$1`, [S.promo]),
  usersVisible: await n(c, `SELECT count(*)::int n FROM identity.users`),
  buyerOfA: await n(c, `SELECT count(*)::int n FROM identity.users WHERE id=$1`, [S.buyerId]),
  ownOrders: await n(c, `SELECT count(*)::int n FROM orders.orders o WHERE o.event_id=$1`, [S.eventB]),
}));
check('L2', 'poradatel B (RLS kontext) NEPRECTE objednavky, vstupenky, polozky, promo kody ani zakazniky poradatele A', rb.ordersOfA === 0 && rb.ticketsOfA === 0 && rb.orderItemsOfA === 0 && rb.promoOfA === 0 && rb.buyerOfA === 0, rb);

const wb = await as(B, async (c) => ({
  updEventA: await n(c, `UPDATE catalog.events SET title='HACKED' WHERE id=$1`, [S.eventA]),
  updTicketTypeA: await n(c, `UPDATE catalog.ticket_types SET base_price=1 WHERE event_id=$1`, [S.eventA]),
  insTicketTypeA: await n(c, `INSERT INTO catalog.ticket_types (event_id, name, base_price, total_qty, remaining_qty) VALUES ($1,'rls-hack',1,10,10)`, [S.eventA]),
  updOrdersA: await n(c, `UPDATE orders.orders SET status='refunded' WHERE event_id=$1`, [S.eventA]),
  updTicketsA: await n(c, `UPDATE tickets.tickets t SET status='revoked' FROM orders.orders o WHERE o.id=t.order_id AND o.event_id=$1`, [S.eventA]),
  delPromoA: await n(c, `DELETE FROM marketing.promo_codes WHERE upper(code)=$1`, [S.promo]),
  updPromoterA: await n(c, `UPDATE platform.promoters SET name='HACKED' WHERE id=$1`, [S.promoterA.id]),
}));
check('L3', 'poradatel B (RLS kontext) NEZAPISE do akci, typu vstupenek, objednavek, vstupenek, promo kodu ani profilu poradatele A', Object.values(wb).every((v) => v === 0 || String(v).startsWith('ERR 42501')), wb);

// ---- kontext ciziho kupce ----
const otherId = (await q(`SELECT id FROM identity.users WHERE email=$1`, [S.otherEmail]))[0].id;
const U = { 'app.current_user_id': otherId, 'app.role': 'user' };
const ru = await as(U, async (c) => ({
  ordersOfBuyer: await n(c, `SELECT count(*)::int n FROM orders.orders WHERE user_id=$1`, [S.buyerId]),
  ticketsOfBuyer: await n(c, `SELECT count(*)::int n FROM tickets.tickets WHERE owner_id=$1`, [S.buyerId]),
  totpSecrets: await n(c, `SELECT count(*)::int n FROM tickets.tickets WHERE totp_secret_encrypted IS NOT NULL AND owner_id<>$1`, [otherId]),
  otherUsers: await n(c, `SELECT count(*)::int n FROM identity.users WHERE id<>$1`, [otherId]),
  stealTicket: await n(c, `UPDATE tickets.tickets SET owner_id=$1 WHERE owner_id=$2`, [otherId, S.buyerId]),
  refundRequests: await n(c, `SELECT count(*)::int n FROM orders.refund_requests`),
}));
check('L4', 'cizi kupec (RLS kontext) NEVIDI objednavky/vstupenky/TOTP tajemstvi jinych a NEPREVEDE si cizi vstupenku', ru.ordersOfBuyer === 0 && ru.ticketsOfBuyer === 0 && ru.totpSecrets === 0 && ru.otherUsers === 0 && (ru.stealTicket === 0 || String(ru.stealTicket).startsWith('ERR')), ru);

// ---- pozitivni kontrola: RLS neni jen "vse zamceno" ----
const pa = await as({ 'app.current_promoter_id': S.promoterA.id, 'app.role': 'promoter' }, async (c) => ({ ordersOfA: await n(c, `SELECT count(*)::int n FROM orders.orders o WHERE o.event_id=$1`, [S.eventA]) }));
check('L5', 'pozitivni kontrola: poradatel A pod RLS vidi SVE objednavky (policy nejsou jen mrtve zamky)', pa.ordersOfA === truth.orders_a && truth.orders_a > 0, { seen: pa.ordersOfA, groundTruth: truth.orders_a });

// ---- eskalace: role si sama nastavi servisni kontext ----
const esc = await as({ 'app.role': 'service' }, async (c) => ({ orders: await n(c, `SELECT count(*)::int n FROM orders.orders`), users: await n(c, `SELECT count(*)::int n FROM identity.users`), user_secrets: await n(c, `SELECT count(*)::int n FROM identity.user_secrets`) }));
check('L6', 'VLASTNOST NAVRHU: kdokoli s pripojenim tixly_app si `set_config(app.role,service)` zapne plny pristup (RLS chrani pred chybou v kodu, ne pred SQL injection)', null, { afterSelfSetServiceRole: esc, groundTruth: truth });

// ---- tabulky bez RLS, na ktere ma tixly_app prava ----
const noRls = await q(`SELECT n.nspname||'.'||c.relname AS t, c.reltuples::int AS est FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind='r' AND NOT c.relrowsecurity AND n.nspname NOT IN ('pg_catalog','information_schema','public','topology','tiger','tiger_data')
  AND has_table_privilege('tixly_app', c.oid, 'SELECT') ORDER BY 1`);
const sensitive = noRls.filter((x) => /user|secret|token|password|payment|payout|bank|order|ticket|kyc|invoice|session|credential|api_key|webhook|otp|refund/i.test(x.t));
check('L7', 'tabulky BEZ RLS citelne roli tixly_app (bez ohledu na tenant)', null, { total: noRls.length, sensitiveByName: sensitive.map((x) => x.t) });
const forced = (await q(`SELECT count(*)::int n FROM pg_class WHERE relforcerowsecurity`))[0].n;
const ownerBypass = (await q(`SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname IN ('neondb_owner','tixly_app')`));
check('L8', 'FORCE ROW LEVEL SECURITY: pocet tabulek (0 = vlastnik tabulek RLS vzdy miji -> app pod neondb_owner = RLS neucinne)', null, { forcedTables: forced, roles: ownerBypass });

summary();
await app.end(); await owner.end();
