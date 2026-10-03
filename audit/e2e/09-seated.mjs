// E2E 09: mista k sezeni — rezervace (hold) s expiraci, soubeh na 1 sedadlo, nakup, dvojity prodej.
// Sedadla se seeduji SQL (6 kusu) — sal bez seating chartu; vse ostatni pres HTTP.
import { readFileSync } from 'node:fs';
import { Client, q, owner, check, ev, startLog, summary, gopayCtl, waitFor, sleep, INTERNAL_TOKEN } from './lib.mjs';

startLog('09_seated');
const S = JSON.parse(readFileSync(new URL(process.env.AUDIT_STATE ?? './state.json', import.meta.url), 'utf8'));
const PA = new Client('promoterA'); let r = await PA.post('/api/auth/login', { email: S.promoterA.email, password: S.pw });
const name = `Sezeni ${Date.now()}`;
r = await PA.post(`/api/admin/events/${S.eventA}/ticket-types`, { name, priceHalire: 70000, totalQty: 6, isSeated: true, kind: 'seated' });
const tt = (await q(`SELECT id, is_seated, kind FROM catalog.ticket_types WHERE event_id=$1 AND name=$2`, [S.eventA, name]))[0];
check('Z0', 'vytvoreni typu vstupenky k sezeni', r.status < 300 && tt?.is_seated === true, { ...ev(r), db: tt });
const seats = (await q(`INSERT INTO catalog.event_seats (event_id, ticket_type_id, sector, row, seat_number, status)
  SELECT $1, $2, 'A', '1', g::text, 'available' FROM generate_series(1,6) g RETURNING id`, [S.eventA, tt.id])).map((x) => x.id);
const seat = async (id) => (await q(`SELECT status, hold_user_id IS NOT NULL AS held, hold_until, order_id, ticket_id FROM catalog.event_seats WHERE id=$1`, [id]))[0];
const hold = (c, ids) => c.post(`/api/events/${S.eventA}/seats/hold`, { seatIds: ids });

const u1 = new Client('u1'), u2 = new Client('u2');
r = await hold(u1, [seats[0], seats[1]]);
const tok1 = r.json?.holdToken ?? r.json?.seatHoldToken ?? r.json?.token;
check('Z1', 'rezervace 2 sedadel (hold) s expiraci', r.status === 200 && !!tok1 && (await seat(seats[0])).status === 'held', { ...ev(r), seat: await seat(seats[0]) });
r = await hold(u2, [seats[0]]);
check('Z2', 'jiny zakaznik nemuze rezervovat jiz drzene sedadlo', r.status >= 400 && r.status < 500, ev(r));

const race = await Promise.all(Array.from({ length: 30 }, (_, i) => hold(new Client(`r${i}`), [seats[2]])));
const won = race.filter((x) => x.status === 200).length;
const h = {}; for (const x of race) { const k = `${x.status}:${x.json?.error ?? 'OK'}`; h[k] = (h[k] ?? 0) + 1; }
check('Z3', '30 soubeznych rezervaci JEDNOHO sedadla -> vyhraje prave 1', won === 1, h);

// nakup drzenych sedadel
const email = `seat-${S.run}-${Date.now()}@audit.test`;
r = await u1.post('/api/checkout', { eventId: S.eventA, ticketTypeId: tt.id, quantity: 2, buyerEmail: email, buyerName: 'Sedici Kupec', seatIds: [seats[0], seats[1]], seatHoldToken: tok1 });
check('Z4', 'checkout drzenych sedadel', r.status === 200 && !!r.json?.orderId, ev(r));
if (r.json?.paymentId) {
  const { orderId, paymentId } = r.json;
  await gopayCtl(paymentId, { state: 'PAID' }); await new Client('n').get(`/api/payments/gopay/webhook?id=${paymentId}`);
  const tk = await waitFor(async () => { const t = await q(`SELECT id, event_seat_id FROM tickets.tickets WHERE order_id=$1`, [orderId]); return t.length >= 2 ? t : null; }, 20000);
  const s0 = await seat(seats[0]);
  check('Z5', 'po zaplaceni: 2 vstupenky navazane na 2 ruzna sedadla, sedadla sold', tk?.length === 2 && new Set(tk.map((t) => t.event_seat_id)).size === 2 && tk.every((t) => t.event_seat_id) && s0.status === 'sold', { tickets: tk, seat0: s0 });
}
// pokus o nakup cizich / prodanych sedadel
r = await u2.post('/api/checkout', { eventId: S.eventA, ticketTypeId: tt.id, quantity: 1, buyerEmail: `thief-${Date.now()}@audit.test`, buyerName: 'Zlodej', seatIds: [seats[0]], seatHoldToken: tok1 });
check('Z6', 'jiz prodane sedadlo nelze koupit znovu (ani s puvodnim hold tokenem)', r.status >= 400 && r.status < 500, ev(r));
r = await u2.post('/api/checkout', { eventId: S.eventA, ticketTypeId: tt.id, quantity: 1, buyerEmail: `thief2-${Date.now()}@audit.test`, buyerName: 'Zlodej', seatIds: [seats[3]], seatHoldToken: '00000000-0000-4000-8000-000000000000' });
check('Z7', 'nakup sedadla bez platne rezervace (cizi/falesny token) odmitnut', r.status >= 400 && r.status < 500, ev(r));
r = await u2.post('/api/checkout', { eventId: S.eventA, ticketTypeId: tt.id, quantity: 1, buyerEmail: `noseat-${Date.now()}@audit.test`, buyerName: 'Bez sedadla' });
check('Z8', 'typ k sezeni nelze koupit bez vyberu sedadla', r.status >= 400 && r.status < 500, ev(r));

// expirace holdu
r = await hold(u2, [seats[4]]);
await q(`UPDATE catalog.event_seats SET hold_until = NOW() - INTERVAL '1 minute' WHERE id=$1`, [seats[4]]);
r = await new Client('cron').post('/api/internal/cron/release-expired-seat-holds', {}, { 'x-internal-token': INTERNAL_TOKEN });
const s4 = await seat(seats[4]);
check('Z9', 'cron uvolni prosle rezervace sedadel (held -> available)', r.status === 200 && s4.status === 'available', { ...ev(r), seat: s4 });
r = await hold(new Client('u3'), [seats[4]]);
check('Z10', 'uvolnene sedadlo lze znovu rezervovat', r.status === 200, ev(r));

const dup = await q(`SELECT event_seat_id, count(*)::int n FROM tickets.tickets WHERE event_seat_id = ANY($1::uuid[]) AND status IN ('valid','used') GROUP BY 1 HAVING count(*) > 1`, [seats]);
check('Z11', 'invariant: zadne sedadlo nema 2 platne vstupenky', dup.length === 0, dup);
summary();
await owner.end();
