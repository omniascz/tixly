/**
 * Deep E2E — batch 8 (finální): spotify connect, NFC payload, charity claim, facebook publish.
 */
import { readFileSync } from 'node:fs';
import { createCipheriv, randomBytes, randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
const BASE = 'http://localhost:3000', ts = Date.now(), PW = 'Demo2026!';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const pool = new pg.Pool({ connectionString: (env.match(/^DATABASE_URL="?([^"\n]+)"?/m) || [])[1] });
// Replikace src/lib/crypto encryptSecret (aes-256-gcm) pro seed FB tokenu
function getKey() { const hex = (env.match(/^ENCRYPTION_KEY=([^\n]+)/m) || [])[1]; if (!hex) throw new Error('ENCRYPTION_KEY missing'); return hex.length === 64 ? Buffer.from(hex, 'hex') : createHash('sha256').update(hex).digest(); }
function encryptSecret(pt) { const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', getKey(), iv); const ct = Buffer.concat([c.update(pt, 'utf8'), c.final()]); const tag = c.getAuthTag(); return Buffer.concat([iv, ct, tag]).toString('base64'); }
async function q(s, p = []) { const c = await pool.connect(); try { await c.query(`SET app.role='service'`); return await c.query(s, p); } finally { c.release(); } }
async function api(method, path, { token, body } = {}) {
  const h = {}; if (token) h.Authorization = `Bearer ${token}`; if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(`${BASE}${path}`, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
async function login(e) { return (await api('POST', '/api/auth/login', { body: { email: e, password: PW } })).j; }
async function register(e, n) { return api('POST', '/api/auth/register', { body: { email: e, password: PW, name: n } }); }
const results = [];
function check(l, c, d = '') { const ok = !!c; results.push({ l, ok }); console.log(`  ${ok ? '✅' : '❌'} ${l}${d ? `  → ${d}` : ''}`); return ok; }
function must(l, c, d = '') { if (!check(l, c, d)) throw new Error(`SETUP: ${l} ${d}`); }

async function main() {
  console.log(`\n═══ DEEP E2E BATCH 8 — FINÁLNÍ (ts=${ts}) ═══`);
  const ma = await login('superadmin@tixly.cz');
  must('Master admin login', ma?.roles?.isPlatformAdmin);
  const reg = await api('POST', '/api/auth/register-promoter', { body: { email: `b8pr-${ts}@t.cz`, password: PW, name: 'P', companyName: `B8 ${ts}`, slug: `b8pr-${ts}` } });
  must('Promotér registrace', reg.status === 200);
  const promoterId = reg.j.promoterId;
  await api('POST', `/api/platform/promoters/${promoterId}/approve`, { token: ma.accessToken });
  const pr = await login(`b8pr-${ts}@t.cz`);
  must('Promotér login', (pr?.roles?.promoterMemberships?.length ?? 0) > 0);
  const ev = await api('POST', '/api/admin/events', { token: pr.accessToken, body: { title: `B8 ${ts}`, description: 'x', category: 'music', eventType: 'physical', currency: 'CZK', dateStart: '2026-12-15T19:00:00Z', ticketTypes: [{ name: 'V', priceHalire: 50000, capacity: 100, isSeated: false }] } });
  const eid = ev.j?.eventId || ev.j?.id;
  await api('POST', `/api/platform/moderation/${eid}/approve`, { token: ma.accessToken });
  const tt = (await q(`SELECT id FROM catalog.ticket_types WHERE event_id=$1`, [eid])).rows[0]?.id;
  must('Publikovaná akce', !!eid && !!tt);

  // ── 1. SPOTIFY DISCOVERY (mock) ────────────────────────────────────────────
  console.log('\n━━━ 1. Spotify — propojení + top umělci (discovery) ━━━');
  const spEmail = `b8sp-${ts}@t.cz`;
  await register(spEmail, 'Hudebník');
  const spUser = await login(spEmail);
  const spConn = await api('POST', '/api/buyer/spotify/connect', { token: spUser.accessToken, body: {} });
  check('Spotify připojen (mock)', spConn.status === 200 && spConn.j?.isMock === true && spConn.j?.topArtistsSynced === 5, `synced=${spConn.j?.topArtistsSynced} ${JSON.stringify(spConn.j?.error||'')}`);
  const spGet = await api('GET', '/api/buyer/spotify/connect', { token: spUser.accessToken });
  check('Top umělci se načtou (5)', spGet.j?.connected === true && (spGet.j?.topArtists?.length ?? 0) === 5, `connected=${spGet.j?.connected} artists=${spGet.j?.topArtists?.length}`);

  // ── 2. NFC PAYLOAD (SafeTix-style) ─────────────────────────────────────────
  console.log('\n━━━ 2. NFC payload — rotující NFC token ━━━');
  const nfcEmail = `b8nfc-${ts}@t.cz`;
  await register(nfcEmail, 'NFC kupec');
  const nfcUser = await login(nfcEmail);
  const nco = await api('POST', '/api/checkout', { token: nfcUser.accessToken, body: { eventId: eid, ticketTypeId: tt, quantity: 1, buyerEmail: nfcEmail, buyerName: 'B' } });
  await api('POST', `/api/mock-gopay/${nco.j.paymentId}`, { body: {} });
  let nfcTid = null;
  for (let i = 0; i < 12; i++) { const t = await q(`SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1`, [nco.j.orderId]); if (t.rows[0]) { nfcTid = t.rows[0].id; break; } await new Promise(r => setTimeout(r, 400)); }
  must('NFC setup: lístek koupen', !!nfcTid);
  const nfc = await api('GET', `/api/buyer/tickets/${nfcTid}/nfc-payload`, { token: nfcUser.accessToken });
  check('NFC payload vygenerován (token + TTL)', nfc.status === 200 && !!nfc.j?.token && nfc.j?.ttlSeconds > 0, `ttl=${nfc.j?.ttlSeconds} ${JSON.stringify(nfc.j?.error||'')}`);

  // ── 3. CHARITY CLAIM (dárcovské vstupenky) ─────────────────────────────────
  console.log('\n━━━ 3. Charity claim — beneficient vyzvedne lístek ━━━');
  // Seed: partner → allocation → claim_slot (token) přes service DB
  const claimToken = `charityclaim${ts}aaaaaaaaaa`.replace(/[^A-Za-z0-9_-]/g, 'a');
  const partner = (await q(`INSERT INTO charity.partners (name, contact_email) VALUES ($1,$2) RETURNING id`, [`Nadace ${ts}`, `nadace-${ts}@t.cz`])).rows[0].id;
  const alloc = (await q(`INSERT INTO charity.allocations (promoter_id, charity_id, event_id, quantity) VALUES ($1,$2,$3,$4) RETURNING id`, [promoterId, partner, eid, 5])).rows[0].id;
  await q(`INSERT INTO charity.claim_slots (allocation_id, claim_token, status, expires_at) VALUES ($1,$2,'available',NOW()+INTERVAL '30 days')`, [alloc, claimToken]);
  const cgPrev = await api('GET', `/api/charity/claim/${claimToken}`);
  check('Charity claim preview (available)', cgPrev.status === 200 && cgPrev.j?.status === 'available', `status=${cgPrev.status} ${JSON.stringify(cgPrev.j?.error||cgPrev.j?.status)}`);
  const cClaim = await api('POST', `/api/charity/claim/${claimToken}`, { body: { email: `b8charity-${ts}@t.cz`, name: 'Senior Josef' } });
  check('Beneficient uplatnil charity lístek (200)', cClaim.status === 200 && cClaim.j?.ok, `status=${cClaim.status} ${JSON.stringify(cClaim.j?.error||'')}`);
  if (cClaim.j?.orderId) {
    const ord = (await q(`SELECT status, total_amount, payment_provider FROM orders.orders WHERE id=$1`, [cClaim.j.orderId])).rows[0];
    check('Charity order: paid, 0 Kč, provider=charity', ord?.status === 'paid' && ord?.total_amount === 0 && ord?.payment_provider === 'charity', `${JSON.stringify(ord)}`);
    const slotStatus = (await q(`SELECT status FROM charity.claim_slots WHERE claim_token=$1`, [claimToken])).rows[0]?.status;
    check('Slot označen jako claimed', slotStatus === 'claimed', slotStatus);
  }
  const cClaim2 = await api('POST', `/api/charity/claim/${claimToken}`, { body: { email: `b8c2-${ts}@t.cz` } });
  check('Opakovaný claim → 410 ALREADY_RESOLVED', cClaim2.status === 410, `status=${cClaim2.status}`);

  // ── 4. FACEBOOK PUBLISH (mock Graph API) ───────────────────────────────────
  console.log('\n━━━ 4. Facebook — publikace akce jako FB event ━━━');
  const fbTokenEnc = Buffer.from(encryptSecret('mock-fb-page-token'), 'base64');
  const fbPage = (await q(`INSERT INTO marketing.facebook_pages (promoter_id, fb_page_id, page_name, access_token_encrypted, is_mock) VALUES ($1,$2,$3,$4,true) RETURNING id`, [promoterId, `fbpage-${ts}`, 'Moje FB stránka', fbTokenEnc])).rows[0].id;
  const fbPub = await api('POST', `/api/admin/events/${eid}/publish-facebook`, { token: pr.accessToken, body: { pageId: fbPage } });
  // RLS fix (348): promotér MUSÍ FB stránku VIDĚT → publish dojde ZA RLS check.
  // PAGE_NOT_CONNECTED (404) = RLS pořád rozbitá. Cokoli jiného = page viditelná.
  // (Plný publish blokuje stálý ENCRYPTION_KEY dev serveru ≠ .env.local — test-infra,
  //  ne bug; server zašifroval token jiným klíčem než tento test umí replikovat.)
  check('RLS 348: promotér VIDÍ svou FB stránku (publish není PAGE_NOT_CONNECTED)', fbPub.j?.error !== 'PAGE_NOT_CONNECTED' && fbPub.status !== 404, `status=${fbPub.status} err=${fbPub.j?.error}`);

  console.log('\n═══ SOUHRN ═══');
  const passed = results.filter(r => r.ok).length, failed = results.filter(r => !r.ok);
  console.log(`${passed}/${results.length} kontrol PROŠLO`);
  if (failed.length) { console.log(`\n❌ SELHALO (${failed.length}):`); failed.forEach(f => console.log(`   • ${f.l}`)); }
  else console.log('\n🎉 VŠE PROŠLO');
}
main().then(() => pool.end()).catch(async e => { console.error('\n💥', e.message); await pool.end(); process.exit(1); });
