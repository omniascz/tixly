/**
 * E2E full lifecycle test — obě strany (master admin + promotér + kupující).
 *
 * Flow:
 *  1. Promotér se zaregistruje (pending)
 *  2. Master admin ho schválí (active)
 *  3. Promotér se přihlásí, založí akci → moderace pending_review
 *  4. Master admin akci schválí → published
 *  5. Kupující koupí vstupenku (checkout → mock platba)
 *  6. Vystaví se vstupenka, order = paid
 *  7. Finanční vyrovnání — promotér vidí statement (gross/fee/net)
 *
 * Ověřuje každý krok i přímo v DB (service kontext). Žádný false-green.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const BASE = 'http://localhost:3000';
const ts = Date.now();
const PW = 'Demo2026!';

// ── DB connection (service kontext kvůli RLS) ────────────────────────────────
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const dbUrl = (env.match(/^DATABASE_URL="?([^"\n]+)"?/m) || [])[1];
if (!dbUrl) throw new Error('DATABASE_URL nenalezeno v .env.local');
const pool = new pg.Pool({ connectionString: dbUrl });

async function q(sql, params = []) {
  const c = await pool.connect();
  try {
    await c.query(`SET app.role = 'service'`); // bypass RLS pro ověřování
    return await c.query(sql, params);
  } finally {
    c.release();
  }
}

// ── HTTP helper ──────────────────────────────────────────────────────────────
async function api(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

const results = [];
function check(label, cond, detail = '') {
  const ok = !!cond;
  results.push({ label, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? `  → ${detail}` : ''}`);
  if (!ok) throw new Error(`KROK SELHAL: ${label} ${detail}`);
}

async function main() {
  console.log(`\n═══ E2E LIFECYCLE TEST (ts=${ts}) ═══\n`);

  // ── 1. Promotér registrace ──────────────────────────────────────────────
  console.log('— KROK 1: Promotér se registruje —');
  const promoEmail = `e2e-promoter-${ts}@test.cz`;
  const reg = await api('POST', '/api/auth/register-promoter', {
    body: {
      email: promoEmail,
      password: PW,
      name: 'E2E Pořadatel',
      companyName: `E2E Test Divadlo ${ts}`,
      slug: `e2e-divadlo-${ts}`,
    },
  });
  check('Registrace promotéra (HTTP 200)', reg.status === 200, `status=${reg.status} ${JSON.stringify(reg.json?.error||'')}`);
  const promoterId = reg.json.promoterId;
  check('Vrácen promoterId', !!promoterId, promoterId);
  const dbPromoter = await q(`SELECT status FROM platform.promoters WHERE id = $1`, [promoterId]);
  check('Promotér v DB má status=pending', dbPromoter.rows[0]?.status === 'pending', dbPromoter.rows[0]?.status);

  // ── 2. Master admin schválí promotéra ───────────────────────────────────
  console.log('\n— KROK 2: Master admin schvaluje promotéra —');
  const maLogin = await api('POST', '/api/auth/login', {
    body: { email: 'superadmin@tixly.cz', password: PW },
  });
  check('Master admin login (HTTP 200)', maLogin.status === 200, `status=${maLogin.status}`);
  check('Master admin má isPlatformAdmin', maLogin.json.roles?.isPlatformAdmin === true);
  const maToken = maLogin.json.accessToken;

  const approve = await api('POST', `/api/platform/promoters/${promoterId}/approve`, { token: maToken });
  check('Schválení promotéra (HTTP 200)', approve.status === 200, `status=${approve.status}`);
  check('Promotér status=active (z API)', approve.json.promoter?.status === 'active', approve.json.promoter?.status);
  const dbPromoter2 = await q(`SELECT status FROM platform.promoters WHERE id = $1`, [promoterId]);
  check('Promotér v DB má status=active', dbPromoter2.rows[0]?.status === 'active', dbPromoter2.rows[0]?.status);

  // ── 3. Promotér se přihlásí a založí akci ────────────────────────────────
  console.log('\n— KROK 3: Promotér se přihlásí a založí akci —');
  const prLogin = await api('POST', '/api/auth/login', {
    body: { email: promoEmail, password: PW },
  });
  check('Promotér login po schválení (HTTP 200)', prLogin.status === 200, `status=${prLogin.status}`);
  check('Promotér má promoterMembership', (prLogin.json.roles?.promoterMemberships?.length ?? 0) > 0);
  const prToken = prLogin.json.accessToken;

  const evCreate = await api('POST', '/api/admin/events', {
    token: prToken,
    body: {
      title: `E2E Koncert ${ts}`,
      description: 'Běžný testovací koncert vážné hudby. Nic závadného.',
      category: 'music',
      eventType: 'physical',
      dateStart: '2026-12-15T19:00:00Z',
      currency: 'CZK',
      ticketTypes: [{ name: 'Vstupenka', priceHalire: 50000, capacity: 100, isSeated: false }],
      publishImmediately: true,
    },
  });
  check('Založení akce (HTTP 200/201)', evCreate.status === 200 || evCreate.status === 201, `status=${evCreate.status} ${JSON.stringify(evCreate.json?.error||evCreate.json?.issues||'')}`);
  const eventId = evCreate.json.eventId || evCreate.json.id;
  check('Vrácen eventId', !!eventId, eventId);
  const dbEvent = await q(`SELECT status, title FROM catalog.events WHERE id = $1`, [eventId]);
  check('Akce v DB je pending_review (čeká na master admina)', dbEvent.rows[0]?.status === 'pending_review', dbEvent.rows[0]?.status);

  // ── 4. Master admin schválí akci ─────────────────────────────────────────
  console.log('\n— KROK 4: Master admin schvaluje akci —');
  const queue = await api('GET', '/api/platform/moderation/queue', { token: maToken });
  check('Moderační fronta načtena (HTTP 200)', queue.status === 200, `status=${queue.status}`);
  const inQueue = (queue.json.items || []).some((i) => i.id === eventId);
  check('Naše akce je ve frontě master admina', inQueue, `${(queue.json.items||[]).length} položek ve frontě`);

  const evApprove = await api('POST', `/api/platform/moderation/${eventId}/approve`, { token: maToken });
  check('Schválení akce (HTTP 200)', evApprove.status === 200, `status=${evApprove.status} ${JSON.stringify(evApprove.json?.error||'')}`);
  const dbEvent2 = await q(`SELECT status FROM catalog.events WHERE id = $1`, [eventId]);
  check('Akce v DB je published', dbEvent2.rows[0]?.status === 'published', dbEvent2.rows[0]?.status);

  // ── 5. Kupující koupí vstupenku ──────────────────────────────────────────
  console.log('\n— KROK 5: Kupující kupuje vstupenku —');
  const ttRes = await q(`SELECT id, base_price, remaining_qty FROM catalog.ticket_types WHERE event_id = $1`, [eventId]);
  const ticketTypeId = ttRes.rows[0]?.id;
  check('Akce má typ vstupenky', !!ticketTypeId, `id=${ticketTypeId} cena=${ttRes.rows[0]?.base_price} zbývá=${ttRes.rows[0]?.remaining_qty}`);

  const buyerEmail = `e2e-buyer-${ts}@test.cz`;
  const checkout = await api('POST', '/api/checkout', {
    body: {
      eventId,
      ticketTypeId,
      quantity: 1,
      buyerEmail,
      buyerName: 'E2E Kupující',
    },
  });
  check('Checkout (HTTP 200)', checkout.status === 200, `status=${checkout.status} ${JSON.stringify(checkout.json?.error||'')}`);
  const orderId = checkout.json.orderId;
  const paymentId = checkout.json.paymentId;
  check('Vrácen orderId + paymentId', !!orderId && !!paymentId, `order=${orderId} pay=${paymentId}`);
  check('Celková cena = 500 Kč (50000 haléřů)', checkout.json.totalAmount === 50000, `${checkout.json.totalAmount}`);

  // ── 6. Dokončení platby → vystavení vstupenky ────────────────────────────
  console.log('\n— KROK 6: Dokončení platby (mock brána) → vystavení vstupenky —');
  const pay = await api('POST', `/api/mock-gopay/${paymentId}`, { body: {} });
  check('Mock platba potvrzena (HTTP 200)', pay.status === 200, `status=${pay.status} ${JSON.stringify(pay.json?.error||'')}`);
  check('Order status = paid', pay.json.status === 'paid', pay.json.status);

  // order-completed je fire-and-forget → chvíli počkáme na vystavení vstupenky
  let tickets = 0;
  for (let i = 0; i < 15; i++) {
    const t = await q(`SELECT COUNT(*)::int AS n FROM tickets.tickets WHERE order_id = $1`, [orderId]);
    tickets = t.rows[0]?.n ?? 0;
    if (tickets > 0) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  check('Vstupenka vystavena (tickets.tickets)', tickets === 1, `${tickets} vstupenek`);
  const dbOrder = await q(`SELECT status, total_amount FROM orders.orders WHERE id = $1`, [orderId]);
  check('Order v DB je paid', dbOrder.rows[0]?.status === 'paid', `status=${dbOrder.rows[0]?.status} částka=${dbOrder.rows[0]?.total_amount}`);
  const dbTt = await q(`SELECT remaining_qty FROM catalog.ticket_types WHERE id = $1`, [ticketTypeId]);
  check('Inventář se snížil (100 → 99)', dbTt.rows[0]?.remaining_qty === 99, `zbývá ${dbTt.rows[0]?.remaining_qty}`);

  // ── 7. Finanční vyrovnání — promotér vidí statement ──────────────────────
  console.log('\n— KROK 7: Finanční vyrovnání (promotér vidí, co dostane) —');
  const payouts = await api('GET', '/api/admin/payouts', { token: prToken });
  check('Payout statement načten (HTTP 200)', payouts.status === 200, `status=${payouts.status}`);
  const bucket = (payouts.json.payouts || []).find((p) => Number(p.grossHalire) >= 50000);
  check('Statement obsahuje náš prodej (gross ≥ 500 Kč)', !!bucket,
    bucket ? `gross=${bucket.grossHalire} fee=${bucket.feesHalire} net=${bucket.netHalire} (${bucket.currency||'CZK'})` : 'žádný bucket');
  if (bucket) {
    check('Platform fee = 5 % (2500 haléřů z 50000)', bucket.feesHalire === 2500, `fee=${bucket.feesHalire}`);
    check('Net payout = gross − fee − holdback (≤ 47500)', bucket.netHalire <= 47500 && bucket.netHalire > 0, `net=${bucket.netHalire}, holdback=${bucket.holdbackHalire ?? 0}`);
  }

  // ── Souhrn ────────────────────────────────────────────────────────────────
  console.log('\n═══ SOUHRN ═══');
  const passed = results.filter((r) => r.ok).length;
  console.log(`${passed}/${results.length} kontrol PROŠLO`);
  console.log(`\nVytvořeno: promotér ${promoterId}, akce ${eventId}, order ${orderId}\n`);
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error('\n💥 TEST PŘERUŠEN:', e.message);
    await pool.end();
    process.exit(1);
  });
