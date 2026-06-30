/**
 * Deep E2E — batch 5: entry slots (timed entry), waitlist, accreditation, will-call.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
const BASE = 'http://localhost:3000', ts = Date.now(), PW = 'Demo2026!';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const pool = new pg.Pool({ connectionString: (env.match(/^DATABASE_URL="?([^"\n]+)"?/m) || [])[1] });
async function q(s, p = []) { const c = await pool.connect(); try { await c.query(`SET app.role='service'`); return await c.query(s, p); } finally { c.release(); } }
async function api(method, path, { token, body } = {}) {
  const h = { 'X-Forwarded-For': '77.'+((Date.now()>>8)%256)+'.'+(Math.floor(Math.random()*256))+'.'+(Math.floor(Math.random()*256)) }; if (token) h.Authorization = `Bearer ${token}`; if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(`${BASE}${path}`, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
async function login(e) { return (await api('POST', '/api/auth/login', { body: { email: e, password: PW } })).j; }
const results = [];
function check(l, c, d = '') { const ok = !!c; results.push({ l, ok }); console.log(`  ${ok ? '✅' : '❌'} ${l}${d ? `  → ${d}` : ''}`); return ok; }
function must(l, c, d = '') { if (!check(l, c, d)) throw new Error(`SETUP: ${l} ${d}`); }

async function main() {
  console.log(`\n═══ DEEP E2E BATCH 5 (ts=${ts}) ═══`);
  const ma = await login('superadmin@tixly.cz');
  must('Master admin login', ma?.roles?.isPlatformAdmin);
  const reg = await api('POST', '/api/auth/register-promoter', { body: { email: `b5pr-${ts}@t.cz`, password: PW, name: 'P', companyName: `B5 ${ts}`, slug: `b5pr-${ts}` } });
  must('Promotér registrace', reg.status === 200);
  await api('POST', `/api/platform/promoters/${reg.j.promoterId}/approve`, { token: ma.accessToken });
  const pr = await login(`b5pr-${ts}@t.cz`);
  must('Promotér login', (pr?.roles?.promoterMemberships?.length ?? 0) > 0);
  const ev = await api('POST', '/api/admin/events', { token: pr.accessToken, body: { title: `B5 ${ts}`, description: 'x', category: 'music', eventType: 'physical', currency: 'CZK', dateStart: '2026-12-15T19:00:00Z', ticketTypes: [{ name: 'V', priceHalire: 50000, capacity: 100, isSeated: false }] } });
  const eid = ev.j?.eventId || ev.j?.id;
  await api('POST', `/api/platform/moderation/${eid}/approve`, { token: ma.accessToken });
  const tt = (await q(`SELECT id FROM catalog.ticket_types WHERE event_id=$1`, [eid])).rows[0]?.id;
  must('Publikovaná akce', !!eid && !!tt);

  // ── 1. ENTRY SLOTS (timed entry) ───────────────────────────────────────────
  console.log('\n━━━ 1. Entry slots — časované vstupy ━━━');
  const gen = await api('POST', `/api/admin/events/${eid}/entry-slots`, { token: pr.accessToken, body: { startDate: '2026-12-15', endDate: '2026-12-15', dailyStart: '10:00', dailyEnd: '14:00', slotDurationMinutes: 60, capacityPerSlot: 30 } });
  check('Sloty vygenerovány (4× hodinový slot)', gen.status === 200 && gen.j?.attempted === 4, `attempted=${gen.j?.attempted} ${JSON.stringify(gen.j?.error||'')}`);
  const slot = (await q(`SELECT id, remaining, status FROM catalog.entry_slots WHERE event_id=$1 ORDER BY slot_start LIMIT 1`, [eid])).rows[0];
  check('Slot je open s kapacitou 30', slot?.status === 'open' && slot?.remaining === 30, `status=${slot?.status} remaining=${slot?.remaining}`);
  if (slot?.id) {
    const co = await api('POST', '/api/checkout', { body: { eventId: eid, ticketTypeId: tt, quantity: 1, buyerEmail: `b5slot-${ts}@t.cz`, buyerName: 'B', entrySlotId: slot.id } });
    check('Checkout s časovým slotem (200)', co.status === 200, `status=${co.status} ${JSON.stringify(co.j?.error||'')}`);
    const remAfter = (await q(`SELECT remaining FROM catalog.entry_slots WHERE id=$1`, [slot.id])).rows[0]?.remaining;
    check('Kapacita slotu snížena (30 → 29)', remAfter === 29, `remaining=${remAfter}`);
  }

  // ── 2. WAITLIST ────────────────────────────────────────────────────────────
  console.log('\n━━━ 2. Waitlist — fronta na vyprodaný typ ━━━');
  const wlEmail = `b5wl-${ts}@t.cz`;
  const wl1 = await api('POST', `/api/events/${eid}/waitlist`, { body: { ticketTypeId: tt, email: wlEmail, name: 'Čekatel' } });
  check('Přihlášení na waitlist (201)', wl1.status === 201 && wl1.j?.status === 'waiting', `status=${wl1.status} ${JSON.stringify(wl1.j?.error||'')}`);
  const wlDb = (await q(`SELECT COUNT(*)::int n FROM catalog.waitlist_entries WHERE ticket_type_id=$1 AND LOWER(email)=LOWER($2)`, [tt, wlEmail])).rows[0]?.n;
  check('Waitlist entry v DB', wlDb === 1, `${wlDb} záznamů`);
  const wl2 = await api('POST', `/api/events/${eid}/waitlist`, { body: { ticketTypeId: tt, email: wlEmail, name: 'Čekatel' } });
  check('Opakované přihlášení → idempotentní (existing)', wl2.j?.existing === true, `existing=${wl2.j?.existing}`);

  // ── 3. ACCREDITATION ───────────────────────────────────────────────────────
  console.log('\n━━━ 3. Accreditation — žádost o akreditaci (media/VIP) ━━━');
  const accEmail = `b5acc-${ts}@t.cz`;
  const acc1 = await api('POST', `/api/events/${eid}/accreditation`, { body: { name: 'Novinář Karel', email: accEmail, category: 'media', organization: 'Deník N' } });
  check('Žádost o akreditaci podána', acc1.status === 200 && acc1.j?.requestId, `status=${acc1.status} ${JSON.stringify(acc1.j?.error||'')}`);
  const accDb = (await q(`SELECT category, applicant_name FROM marketing.accreditation_requests WHERE event_id=$1 AND applicant_email=$2`, [eid, accEmail])).rows[0];
  check('Žádost v DB (category=media)', accDb?.category === 'media', `category=${accDb?.category}`);
  const acc2 = await api('POST', `/api/events/${eid}/accreditation`, { body: { name: 'Novinář Karel', email: accEmail, category: 'media' } });
  check('Duplicitní žádost (stejná kategorie) → 409', acc2.status === 409, `status=${acc2.status}`);
  // jiná kategorie → OK
  const acc3 = await api('POST', `/api/events/${eid}/accreditation`, { body: { name: 'Novinář Karel', email: accEmail, category: 'vip' } });
  check('Jiná kategorie (vip) → projde', acc3.status === 200, `status=${acc3.status}`);

  // ── 4. WILL-CALL (vyzvednutí na pokladně) ──────────────────────────────────
  console.log('\n━━━ 4. Will-call — konfigurace vyzvednutí na místě ━━━');
  const wc = await api('PATCH', `/api/admin/events/${eid}/will-call`, { token: pr.accessToken, body: { deliveryMethods: ['mobile', 'will_call'], willCallPickupLocation: 'Pokladna u vchodu A', willCallPickupHours: '17:00–19:00', willCallIdRequired: true } });
  check('Will-call konfigurace uložena (PATCH 200)', wc.status === 200 && wc.j?.ok, `status=${wc.status} ${JSON.stringify(wc.j?.error||'')}`);
  const wcGet = await api('GET', `/api/admin/events/${eid}/will-call`, { token: pr.accessToken });
  check('Will-call config se načte zpět', wcGet.status === 200 && wcGet.j?.config?.will_call_pickup_location === 'Pokladna u vchodu A', `loc=${wcGet.j?.config?.will_call_pickup_location}`);
  check('Will-call ID required = true', wcGet.j?.config?.will_call_id_required === true);

  console.log('\n═══ SOUHRN ═══');
  const passed = results.filter(r => r.ok).length, failed = results.filter(r => !r.ok);
  console.log(`${passed}/${results.length} kontrol PROŠLO`);
  if (failed.length) { console.log(`\n❌ SELHALO (${failed.length}):`); failed.forEach(f => console.log(`   • ${f.l}`)); }
  else console.log('\n🎉 VŠE PROŠLO');
}
main().then(() => pool.end()).catch(async e => { console.error('\n💥', e.message); await pool.end(); process.exit(1); });
