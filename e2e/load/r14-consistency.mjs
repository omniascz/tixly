/**
 * Kolo 14 / krok 2 — konzistence po náporu: prodaná místa = vystavené vstupenky = zaplacené položky, žádný přeprodej
 * (místo dvakrát), žádné osiřelé holdy po expiraci (holdy a nezaplacené objednávky se posunou do minulosti a spustí
 * se crony release-expired-seat-holds a expire-pending-orders — stejné joby jako v produkci).
 *
 *   node load/r14-consistency.mjs <eventId>     (env: OWNER_URL, BASE_URL, CRON_SECRET)
 */
import pg from 'pg';

const eventId = process.argv[2];
const OWNER_URL = process.env.OWNER_URL ?? 'postgresql://neondb_owner:fixowner@localhost:55632/r14load';
const BASE = process.env.BASE_URL ?? 'http://localhost:3200';
const CRON = process.env.CRON_SECRET ?? '';
const db = new pg.Client({ connectionString: OWNER_URL });
await db.connect();
const one = async (sql, p = [eventId]) => (await db.query(sql, p)).rows[0];

const snapshot = async () => ({
  soldSeats: (await one(`SELECT count(*)::int n FROM catalog.event_seats WHERE event_id = $1 AND status = 'sold'`)).n,
  heldSeats: (await one(`SELECT count(*)::int n FROM catalog.event_seats WHERE event_id = $1 AND status = 'held'`)).n,
  availableSeats: (await one(`SELECT count(*)::int n FROM catalog.event_seats WHERE event_id = $1 AND status = 'available'`)).n,
  paidOrders: (await one(`SELECT count(*)::int n FROM orders.orders WHERE event_id = $1 AND status = 'paid'`)).n,
  pendingOrders: (await one(`SELECT count(*)::int n FROM orders.orders WHERE event_id = $1 AND status = 'pending'`)).n,
  paidItems: (await one(`SELECT count(*)::int n FROM orders.order_items oi JOIN orders.orders o ON o.id = oi.order_id WHERE o.event_id = $1 AND o.status = 'paid'`)).n,
  tickets: (await one(`SELECT count(*)::int n FROM tickets.tickets t JOIN orders.orders o ON o.id = t.order_id WHERE o.event_id = $1 AND t.status = 'valid'`)).n,
  ticketsOnPaid: (await one(`SELECT count(*)::int n FROM tickets.tickets t JOIN orders.orders o ON o.id = t.order_id WHERE o.event_id = $1 AND o.status = 'paid'`)).n,
  soldSeatsOfPaid: (await one(`SELECT count(*)::int n FROM catalog.event_seats es JOIN orders.orders o ON o.id = es.order_id WHERE es.event_id = $1 AND es.status = 'sold' AND o.status = 'paid'`)).n,
  seatInTwoPaidItems: (await one(`SELECT count(*)::int n FROM (SELECT oi.seat_id FROM orders.order_items oi JOIN orders.orders o ON o.id = oi.order_id
                                   WHERE o.event_id = $1 AND o.status IN ('paid','pending') AND oi.seat_id IS NOT NULL GROUP BY oi.seat_id HAVING count(*) > 1) x`)).n,
  seatInTwoTickets: (await one(`SELECT count(*)::int n FROM (SELECT t.event_seat_id FROM tickets.tickets t JOIN orders.orders o ON o.id = t.order_id
                                 WHERE o.event_id = $1 AND t.status IN ('valid','used') AND t.event_seat_id IS NOT NULL GROUP BY t.event_seat_id HAVING count(*) > 1) x`)).n,
  remainingQty: (await one(`SELECT COALESCE(sum(remaining_qty),0)::int n FROM catalog.ticket_types WHERE event_id = $1`)).n,
  capacity: (await one(`SELECT count(*)::int n FROM catalog.event_seats WHERE event_id = $1`)).n,
});

const before = await snapshot();
// „po expiraci": holdy a nezaplacené objednávky do minulosti, pak produkční crony
await db.query(`UPDATE catalog.event_seats SET hold_until = now() - interval '1 second' WHERE event_id = $1 AND status = 'held'`, [eventId]);
await db.query(`UPDATE orders.orders SET expires_at = now() - interval '1 second' WHERE event_id = $1 AND status = 'pending'`, [eventId]);
const cron = {};
for (const job of ['release-expired-seat-holds', 'expire-pending-orders']) {
  const r = await fetch(`${BASE}/api/cron/dispatch?job=${job}`, { headers: { authorization: `Bearer ${CRON}` } });
  cron[job] = r.status;
}
const after = await snapshot();

const checks = {
  noOversell_seatOnce: after.seatInTwoPaidItems === 0 && after.seatInTwoTickets === 0,
  soldSeats_eq_paidItems: after.soldSeatsOfPaid === after.paidItems,
  paidItems_eq_tickets: after.paidItems === after.ticketsOnPaid,
  soldSeats_eq_tickets: after.soldSeats === after.ticketsOnPaid,
  noOrphanHolds: after.heldSeats === 0,
  noPendingAfterExpiry: after.pendingOrders === 0,
  seatsAccountedFor: after.soldSeats + after.availableSeats + after.heldSeats <= after.capacity,
  remainingQty_eq_available: after.remainingQty === after.availableSeats,
};
console.log(JSON.stringify({ eventId, before, cron, after, checks, ok: Object.values(checks).every(Boolean) }, null, 2));
await db.end();
process.exitCode = Object.values(checks).every(Boolean) ? 0 : 1; // ne process.exit — na Windows padal na assertu libuv
