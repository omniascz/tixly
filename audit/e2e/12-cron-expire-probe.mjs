// E2E 12 (kolo 2): skriptovana podoba sondy `s3_cron_expire_probe` (v session 3 ad-hoc).
// Zalozi nezaplacene objednavky (GA i sedadla), nastavi jim expiraci do minulosti a zavola cron
// expire-pending-orders. Ocekavani: HTTP 200, vsechny objednavky `expired`, GA kapacita i sedadla vracena.
// Dispatcher (GET /api/cron/dispatch) se zaznamena jako INFO (vnitrni status propisuje?).
import { readFileSync } from 'node:fs';
import { Client, q, owner, check, ev, startLog, summary, INTERNAL_TOKEN, scenarioBuyer } from './lib.mjs';

startLog('12_cron_expire_probe');
const S = JSON.parse(readFileSync(new URL(process.env.AUDIT_STATE ?? './state.json', import.meta.url), 'utf8'));
const PA = new Client('promoterA');
await PA.post('/api/auth/login', { email: S.promoterA.email, password: S.pw });
const tag = Date.now().toString(36);

// GA typ 20 ks
let r = await PA.post(`/api/admin/events/${S.eventA}/ticket-types`, { name: `Expire GA ${tag}`, priceHalire: 10000, vatRateCode: 'CZ_REDUCED', totalQty: 20 });
const ga = (await q(`SELECT id FROM catalog.ticket_types WHERE event_id=$1 AND name=$2`, [S.eventA, `Expire GA ${tag}`]))[0]?.id;
// sedadlovy typ 2 ks + 2 sedadla (sal bez chartu -> seed SQL jako v 09)
r = await PA.post(`/api/admin/events/${S.eventA}/ticket-types`, { name: `Expire Seat ${tag}`, priceHalire: 20000, vatRateCode: 'CZ_REDUCED', totalQty: 2, isSeated: true, kind: 'seated' });
const st = (await q(`SELECT id FROM catalog.ticket_types WHERE event_id=$1 AND name=$2`, [S.eventA, `Expire Seat ${tag}`]))[0]?.id;
const seats = (await q(`INSERT INTO catalog.event_seats (event_id, ticket_type_id, sector, row, seat_number, status)
  SELECT $1, $2, 'E', '1', g::text, 'available' FROM generate_series(1,2) g RETURNING id`, [S.eventA, st])).map((x) => x.id);

const orders = [];
for (let b = 0; b < 4; b++) {
  const sb = await scenarioBuyer(S, `EXP${b}-${tag}`);
  for (let i = 0; i < 2; i++) {
    const x = await sb.c.post('/api/checkout', { eventId: S.eventA, ticketTypeId: ga, quantity: 2, buyerEmail: sb.email, buyerName: 'Expire GA' });
    if (x.json?.orderId) orders.push(x.json.orderId);
  }
}
const sbSeat = await scenarioBuyer(S, `EXPS-${tag}`);
const hold = await sbSeat.c.post(`/api/events/${S.eventA}/seats/hold`, { seatIds: seats });
const tok = hold.json?.holdToken ?? hold.json?.seatHoldToken ?? hold.json?.token;
const so = await sbSeat.c.post('/api/checkout', { eventId: S.eventA, ticketTypeId: st, quantity: 2, buyerEmail: sbSeat.email, buyerName: 'Expire Seat', seatIds: seats, seatHoldToken: tok });
if (so.json?.orderId) orders.push(so.json.orderId);

const gaBefore = (await q(`SELECT remaining_qty FROM catalog.ticket_types WHERE id=$1`, [ga]))[0].remaining_qty;
check('E0', 'priprava: 8 GA objednavek (16 ks) + 1 sedadlova (2 sedadla) pending', orders.length === 9 && gaBefore === 4, { orders: orders.length, gaRemaining: gaBefore, seatHold: ev(hold), seatCheckout: ev(so) });

await q(`UPDATE orders.orders SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = ANY($1::uuid[])`, [orders]);
await q(`UPDATE catalog.event_seats SET hold_until = NOW() - INTERVAL '1 minute' WHERE id = ANY($1::uuid[]) AND hold_until IS NOT NULL`, [seats]);
const seatsBefore = await q(`SELECT status FROM catalog.event_seats WHERE id = ANY($1::uuid[])`, [seats]);

r = await new Client('cron').post('/api/internal/cron/expire-pending-orders', {}, { 'x-internal-token': INTERNAL_TOKEN });
const stAfter = await q(`SELECT status, count(*)::int n FROM orders.orders WHERE id = ANY($1::uuid[]) GROUP BY 1`, [orders]);
const gaAfter = (await q(`SELECT remaining_qty FROM catalog.ticket_types WHERE id=$1`, [ga]))[0].remaining_qty;
const seatsAfter = await q(`SELECT status, order_id FROM catalog.event_seats WHERE id = ANY($1::uuid[])`, [seats]);
check('E1', 'cron expire-pending-orders -> HTTP 200 (ne 500 / 42703)', r.status === 200, ev(r));
check('E2', 'vsech 9 proslych objednavek -> expired', stAfter.length === 1 && stAfter[0].status === 'expired' && stAfter[0].n === 9, stAfter);
check('E3', 'GA kapacita vracena: remaining 4 -> 20', gaAfter === 20, { gaBefore, gaAfter });
check('E4', 'sedadla uvolnena (available, bez order_id)', seatsAfter.every((x) => x.status === 'available' && !x.order_id), { seatsBefore, seatsAfter });

// dispatcher (Vercel cron) — jen zaznam
if (process.env.CRON_SECRET) {
  const d = await new Client('dispatch').get('/api/cron/dispatch?job=expire-pending-orders', { authorization: `Bearer ${process.env.CRON_SECRET}` });
  check('E5', 'dispatcher: GET /api/cron/dispatch?job=expire-pending-orders (INFO — propisuje vnitrni status?)', null, ev(d));
}

summary();
await owner.end();
