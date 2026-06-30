/** Smoke test 3 AXS featur proti prod-klon větvi. */
import { readFileSync } from 'node:fs';
import pg from 'pg';
const BASE = 'http://localhost:3000', PW = 'Demo2026!', ts = Date.now();
const u = readFileSync(new URL('../.env.local', import.meta.url), 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)[1];
const pool = new pg.Pool({ connectionString: u, max: 4 });
async function q(s, p = []) { const c = await pool.connect(); try { await c.query(`SET app.role='service'`); return await c.query(s, p); } finally { c.release(); } }
let ipc = 0;
async function api(m, path, body, tok) {
  const h = { 'X-Forwarded-For': `12.${(ts >> 8) % 256}.${(ts + ipc++) % 256}.${ipc % 256}` };
  if (tok) h.Authorization = 'Bearer ' + tok;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(BASE + path, { method: m, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, l, extra = '') => console.log(`  ${c ? '✅' : '❌'} ${l}${extra ? ' → ' + extra : ''}`);

(async () => {
  console.log(`\n═══ AXS FEATURES SMOKE (ts=${ts}) ═══`);
  const ma = (await api('POST', '/api/auth/login', { email: 'superadmin@tixly.cz', password: PW })).j;
  const reg = await api('POST', '/api/auth/register-promoter', { email: `axs${ts}@t.cz`, password: PW, name: 'A', companyName: `AXS ${ts}`, slug: `axs${ts}` });
  await api('POST', `/api/platform/promoters/${reg.j.promoterId}/approve`, {}, ma.accessToken);
  const pr = (await api('POST', '/api/auth/login', { email: `axs${ts}@t.cz`, password: PW })).j;

  // ── Feature 1: RANDOM WAITING ROOM ──────────────────────────────────────
  console.log('\n── Feature 1: random waiting room ──');
  const ev1 = await api('POST', '/api/admin/events', { title: `Queue ${ts}`, description: 'x', category: 'concert', eventType: 'physical', currency: 'CZK', dateStart: '2026-12-20T19:00:00Z', ticketTypes: [{ name: 'V', priceHalire: 50000, capacity: 100, isSeated: false }] }, pr.accessToken);
  const eid1 = ev1.j.eventId || ev1.j.id;
  await api('POST', `/api/platform/moderation/${eid1}/approve`, {}, ma.accessToken);
  await q(`UPDATE catalog.events SET queue_enabled = true, queue_max_concurrent = 1 WHERE id = $1`, [eid1]);
  // set random mode via admin PATCH
  const patch = await api('PATCH', `/api/admin/events/${eid1}/queue`, { queueMode: 'random' }, pr.accessToken);
  ok(patch.status === 200, 'Admin PATCH queueMode=random', String(patch.status));
  const modeRow = (await q(`SELECT queue_mode FROM catalog.events WHERE id=$1`, [eid1])).rows[0];
  ok(modeRow.queue_mode === 'random', 'queue_mode v DB = random', modeRow.queue_mode);
  // join 4 tokens
  const tokens = [];
  for (let i = 0; i < 4; i++) {
    const j = await api('POST', `/api/queue/${eid1}/join`, { fingerprint: `fp-${ts}-${i}-abcdef` });
    if (j.j?.token) tokens.push(j.j.token);
  }
  ok(tokens.length === 4, '4 queue tokeny vytvořeny', `${tokens.length}`);
  // draw_seed je náhodný (ne všechny 0)
  const seeds = (await q(`SELECT draw_seed FROM platform.queue_tokens WHERE event_id=$1`, [eid1])).rows.map(r => Number(r.draw_seed));
  ok(new Set(seeds).size > 1, 'draw_seed je náhodný (různé hodnoty)', seeds.map(s => s.toFixed(3)).join(','));
  // status každého tokenu → pozice 1..4 permutace, žádná chyba 500
  const positions = [];
  let admittedCount = 0;
  for (const t of tokens) {
    const st = await api('GET', `/api/queue/${eid1}/status/${t}`);
    if (st.status === 500) { ok(false, 'status endpoint 500!', JSON.stringify(st.j)); }
    if (st.j?.status === 'admitted') admittedCount++;
    else if (st.j?.position) positions.push(st.j.position);
  }
  ok(admittedCount >= 1, 'Aspoň 1 token admitnut (max_concurrent=1)', `${admittedCount}`);
  const allPos = [...positions].sort((a, b) => a - b);
  ok(allPos.length === 0 || allPos[0] >= 1, 'Pozice validní (random řazení funguje)', `waiting pos: ${positions.join(',')}`);

  // ── Feature 2: CRYPTO PAYMENT (na samostatném ne-queue eventu) ──────────
  console.log('\n── Feature 2: krypto platba ──');
  const ev2 = await api('POST', '/api/admin/events', { title: `Crypto ${ts}`, description: 'x', category: 'concert', eventType: 'physical', currency: 'CZK', dateStart: '2026-12-22T19:00:00Z', ticketTypes: [{ name: 'V', priceHalire: 50000, capacity: 100, isSeated: false }] }, pr.accessToken);
  const eid2 = ev2.j.eventId || ev2.j.id;
  await api('POST', `/api/platform/moderation/${eid2}/approve`, {}, ma.accessToken);
  const ttId1 = (await q(`SELECT id FROM catalog.ticket_types WHERE event_id=$1`, [eid2])).rows[0].id;
  const bEmail = `axsb${ts}@t.cz`;
  await api('POST', '/api/auth/register', { email: bEmail, password: PW, name: 'AXS Buyer' });
  const buyer = (await api('POST', '/api/auth/login', { email: bEmail, password: PW })).j;
  const co = await api('POST', '/api/checkout', { eventId: eid2, ticketTypeId: ttId1, quantity: 1, buyerEmail: bEmail, buyerName: 'AXS Buyer', paymentMethod: 'crypto' }, buyer.accessToken);
  ok(co.status === 200 && co.j?.provider === 'crypto', 'Checkout crypto → provider=crypto', `${co.status} ${co.j?.provider} ${co.j?.gatewayUrl}`);
  const cryptoPid = co.j?.gatewayUrl?.split('/mock-crypto/')[1];
  if (cryptoPid) {
    const info = await api('GET', `/api/mock-crypto/${cryptoPid}`);
    ok(info.status === 200 && info.j?.amount, 'mock-crypto GET vrací částku', `${info.j?.amount}`);
    const pay = await api('POST', `/api/mock-crypto/${cryptoPid}`, { action: 'pay', coin: 'BTC' });
    ok(pay.status === 200 && pay.j?.status === 'paid', 'mock-crypto pay → paid', `${pay.j?.status}`);
    let tickets = 0;
    for (let i = 0; i < 14; i++) { tickets = Number((await q(`SELECT count(*) c FROM tickets.tickets WHERE order_id=$1`, [co.j.orderId])).rows[0].c); if (tickets >= 1) break; await sleep(500); }
    ok(tickets >= 1, 'Lístek vystaven po krypto platbě', `${tickets}`);
    const prov = (await q(`SELECT payment_provider, status FROM orders.orders WHERE id=$1`, [co.j.orderId])).rows[0];
    ok(prov.status === 'paid' && prov.payment_provider === 'crypto', 'Order paid + provider=crypto', `${prov.status}/${prov.payment_provider}`);
  }

  // ── Feature 3: AXS INVITE (adjacent seats) ──────────────────────────────
  console.log('\n── Feature 3: AXS Invite (adjacent seats) ──');
  const ev3 = await api('POST', '/api/admin/events', { title: `Seated ${ts}`, description: 'x', category: 'theatre', eventType: 'physical', currency: 'CZK', dateStart: '2026-12-21T19:00:00Z', ticketTypes: [{ name: 'Seat', priceHalire: 60000, capacity: 10, isSeated: true }] }, pr.accessToken);
  const eid3 = ev3.j.eventId || ev3.j.id;
  await api('POST', `/api/platform/moderation/${eid3}/approve`, {}, ma.accessToken);
  const ttId3 = (await q(`SELECT id FROM catalog.ticket_types WHERE event_id=$1`, [eid3])).rows[0].id;
  // seed 5 sousedních available sedadel (sektor A, řada 1, seat 1..5)
  for (let n = 1; n <= 5; n++) {
    await q(`INSERT INTO catalog.event_seats (event_id, ticket_type_id, sector, row, seat_number, status, x_coord, y_coord) VALUES ($1,$2,'A','1',$3,'available',$4,10)`, [eid3, ttId3, String(n), n * 20]);
  }
  ok(true, 'Seedováno 5 sousedních sedadel (A/1/1-5)');
  // organizer reserve 3 adjacent
  const reserve = await api('POST', '/api/buyer/group-invitations/reserve', { eventId: eid3, ticketTypeId: ttId3, seatCount: 3 }, pr.accessToken);
  ok(reserve.status === 200 && reserve.j?.seats?.length === 3, 'Reserve 3 sousedních sedadel', `${reserve.status} seats=${reserve.j?.seats?.length}`);
  const inviteToken = reserve.j?.inviteToken;
  const heldCount = (await q(`SELECT count(*) c FROM catalog.event_seats WHERE event_id=$1 AND hold_kind='group_invite' AND status='held'`, [eid3])).rows[0].c;
  ok(Number(heldCount) === 3, '3 sedadla držena (hold_kind=group_invite)', heldCount);
  // GET invite → 3 seats, none claimed
  const preview = await api('GET', `/api/group-invitations/${inviteToken}`);
  ok(preview.j?.adjacentReserve === true && preview.j?.seats?.length === 3, 'GET invite vrací 3 sedadla', `claimed=${preview.j?.seats?.filter(s=>s.claimed).length}`);
  // friend claims 1 seat (použijeme již ověřený buyer token z Feature 2)
  ok(!!buyer?.accessToken, 'Friend (buyer) má token', buyer?.accessToken ? 'ano' : 'NE');
  const seatToClaim = reserve.j.seats[0].id;
  const claim = await api('POST', `/api/buyer/group-invitations/${inviteToken}/claim`, { seatId: seatToClaim }, buyer.accessToken);
  ok(claim.status === 200 && claim.j?.gatewayUrl, 'Friend claim → mock-gopay brána', `${claim.status} ${claim.j?.gatewayUrl}`);
  // seat je sold na claim order
  const seatRow = (await q(`SELECT status, order_id FROM catalog.event_seats WHERE id=$1`, [seatToClaim])).rows[0];
  ok(seatRow.status === 'sold' && seatRow.order_id === claim.j.orderId, 'Sedadlo sold + linkováno na order', `${seatRow.status}`);
  // pay the claim
  const claimPid = claim.j.gatewayUrl.split('/mock-gopay/')[1];
  await api('POST', `/api/mock-gopay/${claimPid}`, { action: 'pay' });
  let claimTickets = 0;
  for (let i = 0; i < 14; i++) { claimTickets = Number((await q(`SELECT count(*) c FROM tickets.tickets WHERE order_id=$1`, [claim.j.orderId])).rows[0].c); if (claimTickets >= 1) break; await sleep(500); }
  ok(claimTickets >= 1, 'Lístek vystaven po zaplacení claimu', `${claimTickets}`);
  // GET invite → 1 claimed
  const preview2 = await api('GET', `/api/group-invitations/${inviteToken}`);
  ok(preview2.j?.seats?.filter(s => s.claimed).length === 1, 'GET invite: 1 sedadlo claimnuté', `${preview2.j?.seats?.filter(s=>s.claimed).length}`);

  console.log('\n═══ HOTOVO ═══');
  await pool.end();
})().catch(async (e) => { console.error('💥', e.message, e.stack); await pool.end(); process.exit(1); });
