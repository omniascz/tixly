// E2E 07b: tixly_app BEZ jakehokoli kontextu (zadny set_config) — zapis do publikovane akce/typu vstupenek ciziho tenantu.
// Vse v transakci, na konci ROLLBACK (data se nemeni).
import { readFileSync } from 'node:fs';
import pg from 'pg';
const S = JSON.parse(readFileSync(new URL(process.env.AUDIT_STATE ?? './state.json', import.meta.url), 'utf8'));
const c = new pg.Client({ connectionString: process.env.AUDIT_APP_URL ?? 'postgresql://tixly_app:auditapp@localhost:55432/e2e' });
await c.connect(); await c.query('BEGIN');
const out = {};
out.current_user = (await c.query('select current_user')).rows[0].current_user;
out.guc = (await c.query(`select current_setting('app.current_promoter_id', true) p, current_setting('app.role', true) r`)).rows[0];
out.updateEventTitle = (await c.query(`UPDATE catalog.events SET title='HACKED-NO-CONTEXT' WHERE id=$1`, [S.eventA])).rowCount;
out.updateTicketPricesTo1Halir = (await c.query(`UPDATE catalog.ticket_types SET base_price=1 WHERE event_id=$1`, [S.eventA])).rowCount;
out.unlimitedCapacity = (await c.query(`UPDATE catalog.ticket_types SET remaining_qty=total_qty WHERE event_id=$1`, [S.eventA])).rowCount;
out.deletePromoCodes = (await c.query(`DELETE FROM marketing.promo_codes`)).rowCount;
await c.query('SAVEPOINT s');
try { out.deleteEvent = (await c.query(`DELETE FROM catalog.events WHERE id=$1`, [S.eventA2 ?? S.eventB])).rowCount; } catch (e) { out.deleteEvent = `ERR ${e.code} ${e.message.slice(0,80)}`; await c.query('ROLLBACK TO s'); }
out.readBack = (await c.query(`SELECT title, (SELECT min(base_price) FROM catalog.ticket_types WHERE event_id=e.id) min_price FROM catalog.events e WHERE id=$1`, [S.eventA])).rows[0];
await c.query('ROLLBACK'); await c.end();
console.log(JSON.stringify(out, null, 1));
