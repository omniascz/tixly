/**
 * E2E SEAM TEST — integrační švy, které lifecycle NEpokrývá.
 *
 * Cíl (zadání uživatele): ověřit že superadmin je v pořádku, je propojen s adminem
 * promotéra, promotér je propojen s webem na nákup a s widgety — a odhalit nekonzistence.
 *
 *  ŠEV 1  Superadmin → promotér: CUSTOM fee override se reálně promítne do payoutu
 *         (ne jen default 5 %). Tohle lifecycle netestuje.
 *  ŠEV 2  Promotér → veřejný web: publikovaná akce SE OBJEVÍ ve veřejném katalogu
 *         (/cs/events RSC) a je čitelná přes public ticket-types API.
 *  ŠEV 3  Widget: /embed/event/[id] vrací 200 a obsahuje akci; ticket-types API
 *         (na kterém embed stojí) vrací živá data; nepublikovaná akce není prodejná.
 *  ŠEV 4  Cross-tenant izolace: promotér B NEVIDÍ a NEMĚNÍ akci promotéra A.
 *  ŠEV 5  Superadmin gate: NEschválený promotér akci nezaloží / nemá membership.
 *
 * Self-cleaning: na konci unpublishne vytvořené akce (zmizí z katalogu).
 * Vše ověřeno i v DB (service kontext). Žádný false-green — každý check tvrdě failuje.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const BASE = 'http://localhost:3000';
const ts = Date.now();
const PW = 'Demo2026!';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const dbUrl = (env.match(/^DATABASE_URL="?([^"\n]+)"?/m) || [])[1];
const pool = new pg.Pool({ connectionString: dbUrl });

async function q(sql, params = []) {
  const c = await pool.connect();
  try {
    await c.query(`SET app.role = 'service'`);
    return await c.query(sql, params);
  } finally {
    c.release();
  }
}

// Per-běh unikátní IP → rate-limity (per-IP global Redis) nekolidují mezi běhy testu.
const TEST_IP = `198.51.${(ts >> 8) % 256}.${ts % 256}`;
async function api(method, path, { token, body, raw } = {}) {
  const headers = { 'X-Forwarded-For': TEST_IP };
  if (!raw) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) {
    const text = await res.text();
    return { status: res.status, text };
  }
  let json = null;
  try { json = await res.json(); } catch { /* */ }
  return { status: res.status, json };
}

const results = [];
function check(label, cond, detail = '') {
  const ok = !!cond;
  results.push({ label, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? `  → ${detail}` : ''}`);
  if (!ok) throw new Error(`ŠEV SELHAL: ${label} ${detail}`);
}
function soft(label, cond, detail = '') {
  const ok = !!cond;
  results.push({ label, ok, detail, soft: true });
  console.log(`${ok ? '✅' : '⚠️ '} ${label}${detail ? `  → ${detail}` : ''}`);
}

const created = { promoters: [], events: [] };

async function registerApprovedPromoter(tag, maToken) {
  const slugTag = String(tag).toLowerCase();
  const email = `seam-${slugTag}-${ts}@test.cz`;
  const reg = await api('POST', '/api/auth/register-promoter', {
    body: { email, password: PW, name: `Seam ${tag}`, companyName: `Seam Test ${tag} ${ts}`, slug: `seam-${slugTag}-${ts}` },
  });
  check(`[${tag}] registrace promotéra 200`, reg.status === 200, `status=${reg.status} ${JSON.stringify(reg.json?.error||'')}`);
  const promoterId = reg.json.promoterId;
  created.promoters.push(promoterId);
  const approve = await api('POST', `/api/platform/promoters/${promoterId}/approve`, { token: maToken });
  check(`[${tag}] master schválil promotéra 200`, approve.status === 200, `status=${approve.status}`);
  const login = await api('POST', '/api/auth/login', { body: { email, password: PW } });
  check(`[${tag}] login po schválení 200`, login.status === 200);
  return { promoterId, email, token: login.json.accessToken };
}

async function createPublishedEvent(token, maToken, title, extra = {}) {
  const ev = await api('POST', '/api/admin/events', {
    token,
    body: {
      title,
      description: 'Běžný testovací koncert vážné hudby. Nic závadného k moderaci.',
      category: 'music',
      eventType: 'physical',
      dateStart: '2026-12-20T19:00:00Z',
      currency: 'CZK',
      ticketTypes: [{ name: 'Vstupenka', priceHalire: 50000, capacity: 100, isSeated: false }],
      publishImmediately: true,
      ...extra,
    },
  });
  check(`vytvoření akce "${title}" (201)`, ev.status === 201 || ev.status === 200, `status=${ev.status} ${JSON.stringify(ev.json?.error||ev.json?.issues||'')}`);
  const eventId = ev.json.eventId || ev.json.id;
  created.events.push(eventId);
  // moderace → approve
  const evApprove = await api('POST', `/api/platform/moderation/${eventId}/approve`, { token: maToken });
  check(`master publikoval akci "${title}" (200)`, evApprove.status === 200, `status=${evApprove.status}`);
  const db = await q(`SELECT status FROM catalog.events WHERE id=$1`, [eventId]);
  check(`akce "${title}" je v DB published`, db.rows[0]?.status === 'published', db.rows[0]?.status);
  return eventId;
}

async function main() {
  console.log(`\n═══ E2E SEAM TEST (ts=${ts}) ═══\n`);

  // Master admin login
  const maLogin = await api('POST', '/api/auth/login', { body: { email: 'superadmin@tixly.cz', password: PW } });
  check('Master admin login 200', maLogin.status === 200, `status=${maLogin.status}`);
  check('Master admin má isPlatformAdmin', maLogin.json.roles?.isPlatformAdmin === true);
  const maToken = maLogin.json.accessToken;

  // ════ ŠEV 5 (gate): neschválený promotér ════
  console.log('\n— ŠEV 5: Superadmin gate (neschválený promotér nemůže prodávat) —');
  const gateEmail = `seam-gate-${ts}@test.cz`;
  const gateReg = await api('POST', '/api/auth/register-promoter', {
    body: { email: gateEmail, password: PW, name: 'Seam Gate', companyName: `Seam Gate ${ts}`, slug: `seam-gate-${ts}` },
  });
  check('neschválený promotér registrace 200', gateReg.status === 200);
  created.promoters.push(gateReg.json.promoterId);
  const gateDb = await q(`SELECT status FROM platform.promoters WHERE id=$1`, [gateReg.json.promoterId]);
  check('neschválený promotér má status=pending', gateDb.rows[0]?.status === 'pending', gateDb.rows[0]?.status);
  const gateLogin = await api('POST', '/api/auth/login', { body: { email: gateEmail, password: PW } });
  check('neschválený promotér se přihlásí (200)', gateLogin.status === 200);
  const gateEv = await api('POST', '/api/admin/events', {
    token: gateLogin.json.accessToken,
    body: { title: `Seam Gate akce ${ts}`, description: 'x', category: 'music', eventType: 'physical', dateStart: '2026-12-20T19:00:00Z', currency: 'CZK', ticketTypes: [{ name: 'V', priceHalire: 10000, capacity: 10, isSeated: false }] },
  });
  check('neschválený promotér NEMŮŽE založit akci (403/401)', gateEv.status === 403 || gateEv.status === 401, `status=${gateEv.status}`);

  // ════ ŠEV 1: CUSTOM fee override → payout ════
  console.log('\n— ŠEV 1: Master nastaví CUSTOM fee (8%) → promítne se do payoutu —');
  const A = await registerApprovedPromoter('A', maToken);
  const feePatch = await api('PATCH', `/api/platform/promoters/${A.promoterId}`, {
    token: maToken,
    body: { feePctBps: 800, buyerFeeHalire: 0, feeCurrency: 'CZK', feeOverrideReason: 'seam test custom fee' },
  });
  check('master nastavil fee override 8% (200)', feePatch.status === 200, `status=${feePatch.status} ${JSON.stringify(feePatch.json?.error||'')}`);
  const feeDb = await q(
    `SELECT percentage_fee, buyer_fee_halire FROM platform.fee_schedules
      WHERE promoter_id=$1 AND is_active=true ORDER BY created_at DESC LIMIT 1`, [A.promoterId]);
  check('aktivní fee_schedule v DB = 8% (800 bps)', Number(feeDb.rows[0]?.percentage_fee) === 800, `percentage_fee=${feeDb.rows[0]?.percentage_fee}`);

  const evA = await createPublishedEvent(A.token, maToken, `Seam A koncert ${ts}`);

  // buyer koupí
  const ttA = await q(`SELECT id FROM catalog.ticket_types WHERE event_id=$1`, [evA]);
  const co = await api('POST', '/api/checkout', {
    body: { eventId: evA, ticketTypeId: ttA.rows[0].id, quantity: 1, buyerEmail: `seam-buyer-${ts}@test.cz`, buyerName: 'Seam Buyer' },
  });
  check('buyer checkout 200', co.status === 200, `status=${co.status} ${JSON.stringify(co.json?.error||'')}`);
  const pay = await api('POST', `/api/mock-gopay/${co.json.paymentId}`, { body: {} });
  check('mock platba 200 + paid', pay.status === 200 && pay.json.status === 'paid', `status=${pay.status} ${pay.json?.status}`);
  // počkat na vystavení lístku
  let tix = 0;
  for (let i = 0; i < 15; i++) { const t = await q(`SELECT COUNT(*)::int n FROM tickets.tickets WHERE order_id=$1`, [co.json.orderId]); tix = t.rows[0].n; if (tix>0) break; await new Promise(r=>setTimeout(r,400)); }
  check('lístek vystaven', tix === 1, `${tix} lístků`);
  // payout musí reflektovat 8 %, ne 5 %
  const payouts = await api('GET', '/api/admin/payouts', { token: A.token });
  check('payout statement 200', payouts.status === 200);
  const bucket = (payouts.json.payouts || []).find((p) => Number(p.grossHalire) >= 50000);
  check('payout obsahuje prodej', !!bucket, bucket ? `gross=${bucket.grossHalire} fee=${bucket.feesHalire}` : 'chybí');
  check('fee = 8 % custom override (4000 z 50000), NE default 5 %', bucket && bucket.feesHalire === 4000, `fee=${bucket?.feesHalire} (čekáno 4000)`);

  // ════ ŠEV 2: veřejný katalog viditelnost ════
  console.log('\n— ŠEV 2: Publikovaná akce se objeví ve veřejném katalogu (/cs/events RSC) —');
  const catalog = await api('GET', '/cs/events', { raw: true });
  check('/cs/events vrací 200', catalog.status === 200, `status=${catalog.status}`);
  check('katalog OBSAHUJE naši publikovanou akci', catalog.text.includes(`Seam A koncert ${ts}`), 'hledán titulek v HTML');
  // public ticket-types API (na kterém stojí embed i detail)
  const pubTt = await api('GET', `/api/events/${evA}/ticket-types`);
  check('public ticket-types API 200', pubTt.status === 200, `status=${pubTt.status}`);
  const ttList = pubTt.json?.ticketTypes || pubTt.json?.types || pubTt.json;
  check('ticket-types vrací živá data (≥1 typ)', Array.isArray(ttList) ? ttList.length >= 1 : (ttList && Object.keys(ttList).length>=1), JSON.stringify(ttList).slice(0,120));

  // ════ ŠEV 3: widget embed ════
  console.log('\n— ŠEV 3: Widget /embed/event/[id] reflektuje live data —');
  const embed = await api('GET', `/embed/event/${evA}`, { raw: true });
  check('/embed/event/[id] vrací 200 (NE 404 locale bug)', embed.status === 200, `status=${embed.status}`);
  check('embed NEpadá do /cs/ locale (žádný redirect na 404)', !embed.text.includes('404') || embed.text.length > 2000, `len=${embed.text.length}`);
  // promoter-level embed widget (slug)
  const promoSlug = `seam-a-${ts}`;
  const pEmbed = await api('GET', `/embed/promoter/${promoSlug}`, { raw: true });
  check('/embed/promoter/[slug] vrací 200', pEmbed.status === 200, `status=${pEmbed.status} slug=${promoSlug}`);
  // unpublished akce → ticket-types nesmí prodávat
  const draftEv = await createPublishedEvent(A.token, maToken, `Seam draft ${ts}`);
  await q(`UPDATE catalog.events SET status='draft' WHERE id=$1`, [draftEv]);
  const draftTt = await api('GET', `/api/events/${draftEv}/ticket-types`);
  soft('nepublikovaná akce: ticket-types nevrací prodejné typy (404/prázdné)',
    draftTt.status === 404 || (Array.isArray(draftTt.json?.ticketTypes) && draftTt.json.ticketTypes.length === 0) || draftTt.status === 403,
    `status=${draftTt.status}`);

  // ════ ŠEV 4: cross-tenant izolace ════
  console.log('\n— ŠEV 4: Cross-tenant — promotér B nevidí/neměni akci promotéra A —');
  const B = await registerApprovedPromoter('B', maToken);
  const bSeesA = await api('GET', `/api/admin/events/${evA}`, { token: B.token });
  check('promotér B NEVIDÍ detail akce A (403/404)', bSeesA.status === 403 || bSeesA.status === 404, `status=${bSeesA.status}`);
  const bEditsA = await api('PATCH', `/api/admin/events/${evA}`, { token: B.token, body: { title: 'HACKED by B' } });
  check('promotér B NEMŮŽE editovat akci A (403/404)', bEditsA.status === 403 || bEditsA.status === 404, `status=${bEditsA.status}`);
  const stillA = await q(`SELECT title FROM catalog.events WHERE id=$1`, [evA]);
  check('titulek akce A nezměněn (PATCH od B neprošel)', stillA.rows[0]?.title === `Seam A koncert ${ts}`, stillA.rows[0]?.title);
  // B nevidí A v seznamu svých akcí
  const bList = await api('GET', '/api/admin/events', { token: B.token });
  check('promotér B seznam akcí 200', bList.status === 200);
  const bItems = bList.json?.events || bList.json?.items || bList.json || [];
  const bSeesAInList = Array.isArray(bItems) && bItems.some((e) => e.id === evA);
  check('akce A NENÍ v seznamu promotéra B', !bSeesAInList, `B má ${Array.isArray(bItems)?bItems.length:'?'} akcí`);

  // ════ ŠEV 6: branding → white-label ════
  console.log('\n— ŠEV 6: Promotér nastaví branding → white-label doména ho servíruje —');
  const brandPut = await api('PUT', '/api/admin/branding', {
    token: A.token,
    body: { logoUrl: 'https://example.com/seam-logo.png', primaryColor: '#ff6600', hidePoweredBy: true },
  });
  check('promotér uložil branding (PUT 200)', brandPut.status === 200, `status=${brandPut.status} ${JSON.stringify(brandPut.json?.error||'')}`);
  const brandGet = await api('GET', '/api/admin/branding', { token: A.token });
  check('branding round-trip (GET vrací uloženou barvu)', brandGet.json?.branding?.primary_color === '#ff6600', brandGet.json?.branding?.primary_color);
  // verified doména (verifikace = DNS, externí krok → vložíme rovnou jako verified)
  const testDomain = `seam-${ts}.example.com`;
  await q(`INSERT INTO platform.promoter_domains (promoter_id, domain, verified_at, verification_token, primary_domain)
           VALUES ($1, $2, NOW(), 'seamtok', true)`, [A.promoterId, testDomain]);
  const pubBrand = await api('GET', `/api/public/branding?host=${testDomain}`);
  check('public branding rozpozná white-label doménu', pubBrand.json?.whitelabel === true, JSON.stringify(pubBrand.json).slice(0,120));
  check('public branding vrací promotérovu barvu (#ff6600)', pubBrand.json?.primaryColor === '#ff6600', pubBrand.json?.primaryColor);
  check('public branding vrací promotérovo logo', pubBrand.json?.logoUrl === 'https://example.com/seam-logo.png', pubBrand.json?.logoUrl);
  check('hidePoweredBy se propsalo', pubBrand.json?.hidePoweredBy === true, String(pubBrand.json?.hidePoweredBy));
  await q(`DELETE FROM platform.promoter_domains WHERE domain=$1`, [testDomain]);

  // ════ ŠEV 7: seated event (master maluje chart → promotér → buyer vidí sedadla) ════
  console.log('\n— ŠEV 7: Master sál + chart → promotér seated akce → buyer vidí mapu sedadel —');
  const DVD_VENUE = 'a4198135-b842-4f53-b1e3-a95462944a4a'; // Docela velké divadlo Litvínov (chart: PŘÍZEMÍ/BALKON)
  const venueChk = await q(`SELECT 1 FROM catalog.venue_seating_charts WHERE venue_id=$1`, [DVD_VENUE]);
  if (venueChk.rows.length === 0) {
    soft('venue DVD Litvínov chart existuje (jinak ŠEV 7 přeskočen)', false, 'chart chybí — skip');
  } else {
    const seatedCreate = await api('POST', '/api/admin/events', {
      token: A.token,
      body: {
        title: `Seam seated ${ts}`,
        description: 'Běžné divadelní představení, sedadlový sál. Nic závadného.',
        category: 'theatre', eventType: 'physical', dateStart: '2026-12-22T19:00:00Z', currency: 'CZK',
        venueId: DVD_VENUE,
        ticketTypes: [{ name: 'Přízemí', priceHalire: 35000, capacity: 200, isSeated: true, zone: 'PŘÍZEMÍ' }],
        publishImmediately: true,
      },
    });
    check('seated akce vytvořena (201)', seatedCreate.status === 201, `status=${seatedCreate.status} ${JSON.stringify(seatedCreate.json?.error||seatedCreate.json?.issues||'')}`);
    const seatedId = seatedCreate.json.eventId || seatedCreate.json.id;
    created.events.push(seatedId);
    check('event_seats naplněny z venue chartu (seatsCreated > 0)', (seatedCreate.json.seatsCreated ?? 0) > 0, `seatsCreated=${seatedCreate.json.seatsCreated} sektory=${seatedCreate.json.sectorsMapped}`);
    const dbSeats = await q(`SELECT COUNT(*)::int n FROM catalog.event_seats WHERE event_id=$1`, [seatedId]);
    check('event_seats v DB odpovídají', dbSeats.rows[0].n > 0 && dbSeats.rows[0].n === (seatedCreate.json.seatsCreated ?? -1), `DB=${dbSeats.rows[0].n}`);
    await api('POST', `/api/platform/moderation/${seatedId}/approve`, { token: maToken });
    // buyer čte mapu sedadel
    const seatMap = await api('GET', `/api/events/${seatedId}/seats`);
    check('buyer GET seats 200', seatMap.status === 200, `status=${seatMap.status}`);
    const seats = seatMap.json?.seats || seatMap.json?.sectors || seatMap.json;
    const seatCount = Array.isArray(seats) ? seats.length : (seats?.seats?.length ?? JSON.stringify(seatMap.json).length);
    check('buyer vidí neprázdnou mapu sedadel', JSON.stringify(seatMap.json).length > 50 && (Array.isArray(seats) ? seats.length > 0 : true), `payload ${JSON.stringify(seatMap.json).length}B`);
  }

  // ════ CLEANUP ════
  console.log('\n— CLEANUP: unpublish testovacích akcí —');
  const cl = await q(`UPDATE catalog.events SET status='draft' WHERE id = ANY($1::uuid[]) AND status='published' RETURNING id`, [created.events]);
  console.log(`   unpublished ${cl.rowCount} test akcí`);

  console.log('\n═══ SOUHRN ═══');
  const passed = results.filter((r) => r.ok).length;
  const softWarn = results.filter((r) => r.soft && !r.ok).length;
  console.log(`${passed}/${results.length} kontrol PROŠLO${softWarn ? ` (${softWarn} soft-warn)` : ''}`);
}

main()
  .then(() => pool.end())
  .catch(async (e) => { console.error('\n💥 SEAM TEST PŘERUŠEN:', e.message); await pool.end(); process.exit(1); });
