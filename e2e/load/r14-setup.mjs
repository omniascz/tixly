/**
 * Kolo 14 / krok 2 — příprava náporu při spuštění prodeje: sál 500 míst (20 řad × 25, zóna A řady 1–10, zóna B 11–20),
 * termín inscenace Racek v tomto sále (ceník převzatý z Racek Brno, výchozí slevové kategorie), výstup JSON pro k6.
 *
 *   node load/r14-setup.mjs > ../logs/r14/load/setup.json
 * Env: BASE_URL (app), OWNER_URL (Postgres owner, demo DB z create.sh --local).
 */
import pg from 'pg';

const BASE = process.env.BASE_URL ?? 'http://localhost:3200';
const OWNER_URL = process.env.OWNER_URL ?? 'postgresql://neondb_owner:fixowner@localhost:55632/r14load';
const OWNER = { email: 'demo@tixly-staging.test', password: 'Demo2026!heslo' };
const RACEK = '00000000-0000-4000-a000-000000000401';
const RACEK_BRNO = '00000000-0000-4000-a000-000000000501';
const RUN = Date.now().toString(36);

const db = new pg.Client({ connectionString: OWNER_URL });
await db.connect();
const q = async (sql, p = []) => (await db.query(sql, p)).rows;

const promoterId = (await q(`SELECT p.id FROM platform.promoters p JOIN platform.promoter_members m ON m.promoter_id = p.id
  JOIN identity.users u ON u.id = m.user_id WHERE u.email = $1`, [OWNER.email]))[0].id;

// sál 500 míst
const zones = [{ id: 'za', name: 'Zóna A', color: '#dc2626' }, { id: 'zb', name: 'Zóna B', color: '#2563eb' }];
const rows = Array.from({ length: 20 }, (_, r) => ({
  label: String(r + 1),
  seats: Array.from({ length: 25 }, (_, s) => ({ num: String(s + 1), x: 40 + s * 30, y: 120 + r * 30, zone: r < 10 ? 'za' : 'zb' })),
}));
const placeId = (await q(`INSERT INTO catalog.venue_places (promoter_id, name, city, address) VALUES ($1, $2, 'Praha', 'Zátěžová 1') RETURNING id`,
  [promoterId, `Zátěžové divadlo ${RUN}`]))[0].id;
const venueId = (await q(`INSERT INTO catalog.venues (name, city, country, capacity, place_id, promoter_id) VALUES ($1, 'Praha', 'CZ', 500, $2, $3) RETURNING id`,
  [`Zátěžové divadlo ${RUN} – Velký sál`, placeId, promoterId]))[0].id;
await q(`INSERT INTO catalog.venue_seating_charts (venue_id, name, total_seats, layout) VALUES ($1, 'Plánek', 500, $2)`,
  [venueId, JSON.stringify({ zones, sectors: [{ name: 'Přízemí', rows }] })]);

// termín přes API (stejná cesta jako agentura): převzetí ceníku, kopie plánku do event_seats
const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, 'x-real-ip': '10.250.0.1' }, body: JSON.stringify(OWNER) });
const { accessToken } = await login.json();
const auth = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', origin: BASE, 'x-real-ip': '10.250.0.1' };
const term = await fetch(`${BASE}/api/admin/productions/${RACEK}/terms`, {
  method: 'POST', headers: auth,
  body: JSON.stringify({ venueId, copyPricingFromEventId: RACEK_BRNO, dateStart: new Date(Date.now() + 40 * 86_400_000).toISOString() }),
});
const tj = await term.json();
if (!term.ok) throw new Error(`term ${term.status} ${JSON.stringify(tj)}`);
const eventId = tj.eventId;
await db.query(`UPDATE catalog.events SET status = 'published' WHERE id = $1`, [eventId]);
const cat = await fetch(`${BASE}/api/admin/events/${eventId}/categories`, { method: 'POST', headers: auth, body: JSON.stringify({ applyTemplate: true }) });
if (!cat.ok) throw new Error(`categories ${cat.status} ${await cat.text()}`);

const seats = await q(`SELECT id, row::int AS row, seat_number::int AS num FROM catalog.event_seats WHERE event_id = $1 AND status = 'available' ORDER BY row::int, seat_number::int`, [eventId]);
const plne = (await q(`SELECT id FROM catalog.price_categories WHERE event_id = $1 AND code = 'plne'`, [eventId]))[0].id;
process.stdout.write(JSON.stringify({ eventId, venueId, categoryId: plne, seats: seats.map((s) => ({ id: s.id, row: s.row, num: s.num })) }));
await db.end();
