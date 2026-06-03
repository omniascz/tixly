/**
 * E2E HLOUBKOVÝ — cross-tenant ochrana DELETE endpointů (100% verze).
 * Pro KAŽDÝ promotér-scoped DELETE endpoint:
 *   1) vytvoří REÁLNÝ zdroj vlastněný promotérem A,
 *   2) promotér B se ho pokusí smazat → MUSÍ být odmítnut A řádek MUSÍ v DB zůstat,
 *   3) promotér A ho smaže → MUSÍ uspět A řádek MUSÍ z DB zmizet (nebo soft-delete marker).
 * To ověřuje skutečnou autorizační logiku + RLS, ne jen "nepadá 500".
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
const BASE = 'http://localhost:3000', ts = Date.now(), PW = 'Demo2026!';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const pool = new pg.Pool({ connectionString: (env.match(/^DATABASE_URL="?([^"\n]+)"?/m) || [])[1], max: 8 });
async function q(s, p = []) { const c = await pool.connect(); try { await c.query(`SET app.role='service'`); return await c.query(s, p); } finally { c.release(); } }
async function api(method, path, { token, body } = {}) {
  const h = {}; if (token) h.Authorization = `Bearer ${token}`; if (body !== undefined) h['Content-Type'] = 'application/json';
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 12000);
  try { const r = await fetch(`${BASE}${path}`, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ctl.signal }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; }
  catch { return { status: ctl.signal.aborted ? 408 : -1 }; } finally { clearTimeout(timer); }
}
async function login(e) { return (await api('POST', '/api/auth/login', { body: { email: e, password: PW } })).j; }
const results = [];
function check(l, c, d = '') { const ok = !!c; results.push({ l, ok }); if (!ok) console.log(`  ❌ ${l}${d ? `  → ${d}` : ''}`); return ok; }
function must(l, c, d = '') { if (!check(l, c, d)) throw new Error(`SETUP: ${l} ${d}`); console.log(`  ✅ ${l}`); }
async function ins(table, cols) { const k = Object.keys(cols), v = Object.values(cols); const ph = k.map((_, i) => `$${i + 1}`).join(','); const r = await q(`INSERT INTO ${table} (${k.join(',')}) VALUES (${ph}) RETURNING id`, v); return r.rows[0].id; }

async function main() {
  console.log(`\n═══ E2E HLOUBKOVÝ CROSS-TENANT DELETE (ts=${ts}) ═══`);
  const ma = await login('superadmin@tixly.cz');
  must('Master admin login', ma?.roles?.isPlatformAdmin);
  async function mkPromoter(sfx) { const r = await api('POST', '/api/auth/register-promoter', { body: { email: `dd${sfx}-${ts}@t.cz`, password: PW, name: 'D', companyName: `DD${sfx} ${ts}`, slug: `dd${sfx}-${ts}` } }); await api('POST', `/api/platform/promoters/${r.j.promoterId}/approve`, { token: ma.accessToken }); const lg = await login(`dd${sfx}-${ts}@t.cz`); return { promoterId: r.j.promoterId, token: lg.accessToken, userId: lg.user?.id }; }
  const A = await mkPromoter('a'), B = await mkPromoter('b');
  must('Promotér A + B', !!A.token && !!B.token && !!A.promoterId && !!B.promoterId);
  const ev = await api('POST', '/api/admin/events', { token: A.token, body: { title: `DD ${ts}`, description: 'x', category: 'music', eventType: 'physical', currency: 'CZK', dateStart: '2026-12-20T19:00:00Z', ticketTypes: [{ name: 'V', priceHalire: 50000, capacity: 100, isSeated: false }] } });
  const eid = ev.j?.eventId || ev.j?.id;
  await api('POST', `/api/platform/moderation/${eid}/approve`, { token: ma.accessToken });
  const ttId = (await q(`SELECT id FROM catalog.ticket_types WHERE event_id=$1`, [eid])).rows[0]?.id;
  must('Akce A + ticket type', !!eid && !!ttId);
  // 2 throwaway členové (pro staff/team)
  const u1 = await ins('identity.users', { email: `m1-${ts}@t.cz`, gdpr_consent_at: new Date().toISOString() });
  const u2 = await ins('identity.users', { email: `m2-${ts}@t.cz`, gdpr_consent_at: new Date().toISOString() });
  must('2 throwaway členové', !!u1 && !!u2);

  // ── Definice endpointů: seed → reálný zdroj A, deleteUrl, alive-check ─────────
  const C = { eid, ttId, pA: A.promoterId, pB: B.promoterId };
  const EP = [
    { n: 'access-codes/[id]', seed: async () => { const id = await ins('catalog.access_codes', { event_id: eid, promoter_id: C.pA, code: `AC${ts}` }); return { id, url: `/api/admin/access-codes/${id}` }; }, alive: (id) => `SELECT 1 FROM catalog.access_codes WHERE id='${id}'` },
    { n: 'ads/campaigns/[id]', soft: true, seed: async () => { const id = await ins('marketing.ad_campaigns', { promoter_id: C.pA, event_id: eid, slot: 'search_top', cpc_halire: 100, budget_halire: 10000, budget_remaining: 10000 }); return { id, url: `/api/admin/ads/campaigns/${id}` }; }, alive: (id) => `SELECT 1 FROM marketing.ad_campaigns WHERE id='${id}' AND status<>'finished'` },
    { n: 'collections/[id]/events', seed: async () => { const cid = await ins('catalog.event_collections', { slug: `col-${ts}`, title: 'C', promoter_id: C.pA }); await q(`INSERT INTO catalog.collection_events (collection_id,event_id) VALUES ($1,$2)`, [cid, eid]); return { id: cid, url: `/api/admin/collections/${cid}/events?eventId=${eid}` }; }, alive: (id) => `SELECT 1 FROM catalog.collection_events WHERE collection_id='${id}' AND event_id='${eid}'` },
    { n: 'event-groups/[id]/members', seed: async () => { const gid = await ins('event_groups.groups', { promoter_id: C.pA, name: 'G', slug: `g-${ts}` }); await q(`INSERT INTO event_groups.members (group_id,event_id) VALUES ($1,$2)`, [gid, eid]); return { id: gid, url: `/api/admin/event-groups/${gid}/members?eventId=${eid}` }; }, alive: (id) => `SELECT 1 FROM event_groups.members WHERE group_id='${id}' AND event_id='${eid}'` },
    { n: 'event-groups/[id]/shares', soft: true, seed: async () => { const gid = await ins('event_groups.groups', { promoter_id: C.pA, name: 'GS', slug: `gs-${ts}` }); const sid = await ins('event_groups.shares', { group_id: gid, owner_promoter_id: C.pA, shared_with_promoter_id: C.pB }); return { id: sid, url: `/api/admin/event-groups/${gid}/shares?shareId=${sid}` }; }, alive: (id) => `SELECT 1 FROM event_groups.shares WHERE id='${id}' AND status<>'revoked'` },
    { n: 'events/[id]/addons/[addonId]', seed: async () => { const id = await ins('public.checkout_addons', { promoter_id: C.pA, event_id: eid, name: 'Addon', category: 'merch', price_halire: 5000 }); return { id, url: `/api/admin/events/${eid}/addons/${id}` }; }, alive: (id) => `SELECT 1 FROM public.checkout_addons WHERE id='${id}'` },
    { n: 'events/[id]/artists', seed: async () => { const aid = await ins('lineups.artists', { event_id: eid, promoter_id: C.pA, name: `Art${ts}` }); await q(`INSERT INTO lineups.event_artists (event_id,artist_id) VALUES ($1,$2)`, [eid, aid]); return { id: aid, url: `/api/admin/events/${eid}/artists?artistId=${aid}` }; }, alive: (id) => `SELECT 1 FROM lineups.event_artists WHERE event_id='${eid}' AND artist_id='${id}'` },
    { n: 'events/[id]/channel-prices', seed: async () => { const id = await ins('catalog.ticket_type_channel_prices', { ticket_type_id: ttId, channel_key: 'pos', price_override: 40000 }); return { id, url: `/api/admin/events/${eid}/channel-prices?overrideId=${id}` }; }, alive: (id) => `SELECT 1 FROM catalog.ticket_type_channel_prices WHERE id='${id}'` },
    { n: 'events/[id]/custom-fields/[fieldId]', seed: async () => { const id = await ins('catalog.event_custom_fields', { event_id: eid, field_key: `f${ts}`, label: 'L', field_type: 'text' }); return { id, url: `/api/admin/events/${eid}/custom-fields/${id}` }; }, alive: (id) => `SELECT 1 FROM catalog.event_custom_fields WHERE id='${id}'` },
    { n: 'events/[id]/days/[dayId]', seed: async () => { const id = await ins('catalog.event_days', { event_id: eid, day_index: 99, starts_at: '2026-12-21T18:00:00Z', ends_at: '2026-12-21T22:00:00Z' }); return { id, url: `/api/admin/events/${eid}/days/${id}` }; }, alive: (id) => `SELECT 1 FROM catalog.event_days WHERE id='${id}'` },
    { n: 'events/[id]/group-discounts', seed: async () => { const id = await ins('catalog.group_discount_tiers', { ticket_type_id: ttId, min_quantity: 5, label: 'T', discount_pct: 10 }); return { id, url: `/api/admin/events/${eid}/group-discounts?tierId=${id}` }; }, alive: (id) => `SELECT 1 FROM catalog.group_discount_tiers WHERE id='${id}'` },
    { n: 'events/[id]/wallet-modules', seed: async () => { const id = await ins('tickets.wallet_content_modules', { event_id: eid, module_type: 'custom', title: 'W' }); return { id, url: `/api/admin/events/${eid}/wallet-modules?moduleId=${id}` }; }, alive: (id) => `SELECT 1 FROM tickets.wallet_content_modules WHERE id='${id}'` },
    { n: 'member-pricing-rules', seed: async () => { const gid = await ins('platform.member_groups', { promoter_id: C.pA, slug: `mg-${ts}`, name: 'MG' }); const id = await ins('catalog.member_pricing_rules', { ticket_type_id: ttId, group_id: gid, discount_pct: 10 }); return { id, url: `/api/admin/member-pricing-rules?id=${id}` }; }, alive: (id) => `SELECT 1 FROM catalog.member_pricing_rules WHERE id='${id}'` },
    { n: 'notifications/[id]', seed: async () => { const id = await ins('notifications.promoter_notifications', { promoter_id: C.pA, kind: 'general', title: 'N' }); return { id, url: `/api/admin/notifications/${id}` }; }, alive: (id) => `SELECT 1 FROM notifications.promoter_notifications WHERE id='${id}'` },
    { n: 'oauth-apps/[id]', seed: async () => { const id = await ins('b2b.oauth_clients', { client_id: `cl${ts}`, client_secret_hash: 'x', app_name: 'App', redirect_uris: ['https://x.cz/cb'], owner_promoter_id: C.pA }); return { id, url: `/api/admin/oauth-apps/${id}` }; }, alive: (id) => `SELECT 1 FROM b2b.oauth_clients WHERE id='${id}'` },
    { n: 'staff/[userId]', seed: async () => { await q(`INSERT INTO platform.promoter_members (promoter_id,user_id,role) VALUES ($1,$2,'staff')`, [C.pA, u1]); return { id: u1, url: `/api/admin/staff/${u1}` }; }, alive: () => `SELECT 1 FROM platform.promoter_members WHERE promoter_id='${C.pA}' AND user_id='${u1}'` },
    { n: 'team/[memberId]', seed: async () => { await q(`INSERT INTO platform.promoter_members (promoter_id,user_id,role) VALUES ($1,$2,'admin')`, [C.pA, u2]); return { id: u2, url: `/api/admin/team/${u2}` }; }, alive: () => `SELECT 1 FROM platform.promoter_members WHERE promoter_id='${C.pA}' AND user_id='${u2}'` },
    { n: 'subscription-plans/[id]', seed: async () => { const id = await ins('subscriptions.plans', { promoter_id: C.pA, name: 'P', price_halire: 10000, billing_cycle: 'monthly', allowance_per_period: 1, active: true }); return { id, url: `/api/admin/subscription-plans/${id}` }; }, alive: (id) => `SELECT 1 FROM subscriptions.plans WHERE id='${id}'` },
    { n: 'ticket-types/[id]/dynamic-pricing', seed: async () => { await q(`INSERT INTO catalog.dynamic_pricing_rules (ticket_type_id,min_price_minor,max_price_minor) VALUES ($1,10000,90000)`, [ttId]); return { id: ttId, url: `/api/admin/ticket-types/${ttId}/dynamic-pricing` }; }, alive: () => `SELECT 1 FROM catalog.dynamic_pricing_rules WHERE ticket_type_id='${ttId}'` },
    { n: 'ticket-types/[id]/flex-settings', seed: async () => { await q(`INSERT INTO catalog.flex_pass_settings (ticket_type_id,picks_required) VALUES ($1,3)`, [ttId]); return { id: ttId, url: `/api/admin/ticket-types/${ttId}/flex-settings` }; }, alive: () => `SELECT 1 FROM catalog.flex_pass_settings WHERE ticket_type_id='${ttId}'` },
    { n: 'ticket-types/[id]/volume-discount', seed: async () => { await q(`INSERT INTO catalog.volume_discount_rules (ticket_type_id,min_qty,discount_pct) VALUES ($1,5,10)`, [ttId]); return { id: ttId, url: `/api/admin/ticket-types/${ttId}/volume-discount` }; }, alive: () => `SELECT 1 FROM catalog.volume_discount_rules WHERE ticket_type_id='${ttId}'` },
    { n: 'webhooks/[id]', seed: async () => { const id = await ins('reservations.webhook_endpoints', { promoter_id: C.pA, url: 'https://x.cz/wh', secret: 'sec', events: ['order.paid'] }); return { id, url: `/api/admin/webhooks/${id}` }; }, alive: (id) => `SELECT 1 FROM reservations.webhook_endpoints WHERE id='${id}'` },
  ];

  console.log('\n━━━ Cross-tenant test každého endpointu (B odmítnut+řádek zůstane / A uspěje+řádek zmizí) ━━━');
  let pass = 0, fail = 0;
  for (const ep of EP) {
    let seed;
    try { seed = await ep.seed(); } catch (e) { console.log(`  ⚠️  ${ep.n}  SEED FAIL: ${e.message}`); fail++; continue; }
    // 1) B se pokusí smazat A zdroj
    const bDel = await api('DELETE', seed.url, { token: B.token });
    const aliveAfterB = (await q(ep.alive(seed.id))).rows.length > 0;
    const bBlocked = bDel.status < 200 || bDel.status >= 300; // ne-2xx = odmítnut
    // 2) A smaže vlastní zdroj
    const aDel = await api('DELETE', seed.url, { token: A.token });
    const aliveAfterA = (await q(ep.alive(seed.id))).rows.length > 0;
    const aOk = aDel.status >= 200 && aDel.status < 300;
    const allGood = bBlocked && aliveAfterB && aOk && !aliveAfterA;
    if (allGood) { pass++; console.log(`  ✅ ${ep.n}`); }
    else { fail++; console.log(`  ❌ ${ep.n}  → B:status=${bDel.status} blocked=${bBlocked} stillAlive=${aliveAfterB} | A:status=${aDel.status} ok=${aOk} gone=${!aliveAfterA}`); }
    results.push({ l: `cross-tenant ${ep.n}`, ok: allGood });
  }

  // holds — auth-only (UPDATE event_seats, bez seedovaného řádku)
  console.log('\n━━━ events/[id]/holds (auth-only — release UPDATE) ━━━');
  const bHold = await api('DELETE', `/api/admin/events/${eid}/holds`, { token: B.token, body: { kind: 'promoter' } });
  const aHold = await api('DELETE', `/api/admin/events/${eid}/holds`, { token: A.token, body: { kind: 'promoter' } });
  check('holds: B odmítnut + A povolen', (bHold.status < 200 || bHold.status >= 300) && aHold.status >= 200 && aHold.status < 300, `B=${bHold.status} A=${aHold.status}`) ? (pass++, console.log('  ✅ events/[id]/holds')) : fail++;

  console.log('\n═══ SOUHRN ═══');
  console.log(`${pass} PASS / ${fail} FAIL  (z ${EP.length + 1} endpointů, 2 aserce každý)`);
  const failed = results.filter(r => !r.ok);
  if (failed.length) { console.log(`\n❌ SELHALO:`); failed.forEach(f => console.log(`   • ${f.l}`)); }
  else console.log('\n🎉 VŠE PROŠLO — žádný endpoint nedovolí cizímu promotérovi smazat data + vlastník smaže své.');
}
main().then(() => pool.end()).catch(async e => { console.error('\n💥', e.message); await pool.end(); process.exit(1); });
