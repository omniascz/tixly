/**
 * Deep E2E — batch 4: GDPR export/delete, payment plans (splátky), cross-pass.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
const BASE = 'http://localhost:3000', ts = Date.now(), PW = 'Demo2026!';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const pool = new pg.Pool({ connectionString: (env.match(/^DATABASE_URL="?([^"\n]+)"?/m) || [])[1] });
async function q(s, p = []) { const c = await pool.connect(); try { await c.query('BEGIN'); await c.query(`SET LOCAL app.role = 'service'`); const _r = await c.query(s, p); await c.query('COMMIT'); return _r; } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); } }
async function api(method, path, { token, body, raw } = {}) {
  const h = { 'X-Forwarded-For': '77.'+((Date.now()>>8)%256)+'.'+(Math.floor(Math.random()*256))+'.'+(Math.floor(Math.random()*256)) }; if (token) h.Authorization = `Bearer ${token}`; if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(`${BASE}${path}`, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (raw) { const txt = await r.text(); return { status: r.status, txt, ct: r.headers.get('content-type') }; }
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
async function login(e) { return (await api('POST', '/api/auth/login', { body: { email: e, password: PW } })).j; }
async function register(e, n) { return api('POST', '/api/auth/register', { body: { email: e, password: PW, name: n } }); }
const results = [];
function check(l, c, d = '') { const ok = !!c; results.push({ l, ok }); console.log(`  ${ok ? '✅' : '❌'} ${l}${d ? `  → ${d}` : ''}`); return ok; }
function must(l, c, d = '') { if (!check(l, c, d)) throw new Error(`SETUP: ${l} ${d}`); }
async function mkEvent(prToken, maToken, title) {
  const ev = await api('POST', '/api/admin/events', { token: prToken, body: { title, description: 'x', category: 'music', eventType: 'physical', currency: 'CZK', dateStart: '2026-12-15T19:00:00Z', ticketTypes: [{ name: 'V', priceHalire: 50000, capacity: 100, isSeated: false }] } });
  const eid = ev.j?.eventId || ev.j?.id;
  if (eid) await api('POST', `/api/platform/moderation/${eid}/approve`, { token: maToken });
  const tt = eid ? (await q(`SELECT id FROM catalog.ticket_types WHERE event_id=$1`, [eid])).rows[0]?.id : null;
  return { eid, tt };
}
async function buyAndPay(eid, tt, email, token) {
  const co = await api('POST', '/api/checkout', { token, body: { eventId: eid, ticketTypeId: tt, quantity: 1, buyerEmail: email, buyerName: 'B' } });
  if (co.status !== 200) return { ok: false, co };
  await api('POST', `/api/mock-gopay/${co.j.paymentId}`, { body: {} });
  await new Promise(r => setTimeout(r, 1200));
  return { ok: true, orderId: co.j.orderId };
}

async function main() {
  console.log(`\n═══ DEEP E2E BATCH 4 (ts=${ts}) ═══`);
  const ma = await login('superadmin@tixly.cz');
  must('Master admin login', ma?.roles?.isPlatformAdmin);
  const reg = await api('POST', '/api/auth/register-promoter', { body: { email: `b4pr-${ts}@t.cz`, password: PW, name: 'P', companyName: `B4 ${ts}`, slug: `b4pr-${ts}` } });
  must('Promotér registrace', reg.status === 200);
  await api('POST', `/api/platform/promoters/${reg.j.promoterId}/approve`, { token: ma.accessToken });
  const pr = await login(`b4pr-${ts}@t.cz`);
  must('Promotér login', (pr?.roles?.promoterMemberships?.length ?? 0) > 0);
  const e1 = await mkEvent(pr.accessToken, ma.accessToken, `B4-A ${ts}`);
  must('Akce A publikovaná', !!e1.eid && !!e1.tt);

  // ── 1. GDPR EXPORT ─────────────────────────────────────────────────────────
  console.log('\n━━━ 1. GDPR export — stáhnutí všech mých dat ━━━');
  const gdEmail = `b4gdpr-${ts}@t.cz`;
  await register(gdEmail, 'Subjekt Údajů');
  const gdUser = await login(gdEmail);
  await buyAndPay(e1.eid, e1.tt, gdEmail, gdUser.accessToken);
  const exp = await api('GET', '/api/buyer/gdpr/export', { token: gdUser.accessToken, raw: true });
  check('Export vrácen jako JSON download (200)', exp.status === 200 && (exp.ct || '').includes('application/json'), `status=${exp.status} ct=${exp.ct}`);
  let data = null; try { data = JSON.parse(exp.txt); } catch {}
  check('Export obsahuje profil s mým e-mailem', data?.profile?.email === gdEmail, `email=${data?.profile?.email}`);
  check('Export obsahuje moje objednávky', Array.isArray(data?.orders) && data.orders.length >= 1, `orders=${data?.orders?.length}`);
  const gdReq = (await q(`SELECT COUNT(*)::int n FROM identity.gdpr_requests WHERE user_id=(SELECT id FROM identity.users WHERE email=$1) AND type='export'`, [gdEmail])).rows[0]?.n;
  check('Export žádost zalogována (GDPR audit)', gdReq >= 1, `${gdReq} záznamů`);

  // ── 2. GDPR DELETE (žádost + grace + cancel) ───────────────────────────────
  console.log('\n━━━ 2. GDPR delete — žádost o smazání (30d grace) ━━━');
  const del = await api('POST', '/api/buyer/gdpr/delete', { token: gdUser.accessToken });
  check('Žádost o smazání vytvořena (pending, scheduled)', del.status === 200 && del.j?.status === 'pending' && !!del.j?.scheduledAt, `status=${del.status} ${JSON.stringify(del.j).slice(0,80)}`);
  const delStatus = await api('GET', '/api/buyer/gdpr/delete', { token: gdUser.accessToken });
  check('Status žádosti = pending', delStatus.j?.request?.status === 'pending');
  const delDup = await api('POST', '/api/buyer/gdpr/delete', { token: gdUser.accessToken });
  check('Druhá žádost odmítnuta (409 ALREADY_REQUESTED)', delDup.status === 409);
  const delCancel = await api('DELETE', '/api/buyer/gdpr/delete', { token: gdUser.accessToken });
  check('Žádost zrušena (DELETE → ok)', delCancel.status === 200 && delCancel.j?.ok);

  // ── 3. PAYMENT PLANS (splátky) ─────────────────────────────────────────────
  console.log('\n━━━ 3. Payment plans — záloha + splátky ━━━');
  const plan = await api('POST', `/api/admin/events/${e1.eid}/payment-plans`, { token: pr.accessToken, body: { name: '25% + 3 splátky', depositPct: 25, installmentsCount: 3, intervalDays: 30 } });
  check('Splátkový plán vytvořen (201)', plan.status === 201 && plan.j?.id, `status=${plan.status} ${JSON.stringify(plan.j?.error||plan.j?.issues||'')}`);
  const ppEmail = `b4pp-${ts}@t.cz`;
  await register(ppEmail, 'Splátkař');
  const ppUser = await login(ppEmail);
  // pending order (checkout BEZ zaplacení)
  const pend = await api('POST', '/api/checkout', { token: ppUser.accessToken, body: { eventId: e1.eid, ticketTypeId: e1.tt, quantity: 1, buyerEmail: ppEmail, buyerName: 'B' } });
  must('Payment plan: pending objednávka vytvořena', pend.status === 200 && pend.j?.orderId);
  if (plan.j?.id) {
    const attach = await api('POST', `/api/buyer/orders/${pend.j.orderId}/payment-plan`, { token: ppUser.accessToken, body: { planId: plan.j.id } });
    check('Splátkový plán připojen k objednávce (200)', attach.status === 200, `status=${attach.status} ${JSON.stringify(attach.j?.error||'')}`);
    check('Záloha 25 % = 12500 haléřů', attach.j?.depositAmount === 12500, `deposit=${attach.j?.depositAmount} remaining=${attach.j?.remainingAmount}`);
    const inst = (await q(`SELECT COUNT(*)::int n, SUM(amount)::int s FROM orders.payment_installments WHERE order_payment_plan_id=$1`, [attach.j?.orderPaymentPlanId])).rows[0];
    check('Vytvořeny 3 splátky (součet 37500)', inst?.n === 3 && inst?.s === 37500, `${inst?.n} splátek, součet ${inst?.s}`);
    // Zaplať zálohu → paid_partial
    await api('POST', `/api/mock-gopay/${pend.j.paymentId}`, { body: {} });
    await new Promise(r => setTimeout(r, 800));
    const ordStatus = (await q(`SELECT status FROM orders.orders WHERE id=$1`, [pend.j.orderId])).rows[0]?.status;
    check('Po zaplacení zálohy → paid_partial', ordStatus === 'paid_partial', `status=${ordStatus}`);
  }

  // ── 4. CROSS-PASS (multi-event bundle) ─────────────────────────────────────
  console.log('\n━━━ 4. Cross-pass — multi-event permanentka ━━━');
  const e2 = await mkEvent(pr.accessToken, ma.accessToken, `B4-B ${ts}`);
  const bundle = await api('POST', '/api/admin/cross-passes', { token: pr.accessToken, body: { name: `Cross ${ts}`, priceHalire: 90000, eventIds: [e1.eid, e2.eid] } });
  check('Cross-pass bundle vytvořen (2 akce)', bundle.status === 201 && bundle.j?.id, `status=${bundle.status} ${JSON.stringify(bundle.j?.error||bundle.j?.issues||'')}`);
  if (bundle.j?.id) {
    const cpEmail = `b4cp-${ts}@t.cz`;
    const purchase = await api('POST', '/api/buyer/cross-passes/purchase', { body: { bundleId: bundle.j.id, buyerEmail: cpEmail, buyerName: 'Pasák' } });
    check('Cross-pass zakoupen (201)', purchase.status === 201 && purchase.j?.membershipId, `status=${purchase.status} ${JSON.stringify(purchase.j?.error||'')}`);
    if (purchase.j?.membershipId) {
      const mem = (await q(`SELECT status FROM tickets.cross_pass_memberships WHERE id=$1`, [purchase.j.membershipId])).rows[0]?.status;
      check('Membership je active', mem === 'active', mem);
    }
  }

  console.log('\n═══ SOUHRN ═══');
  const passed = results.filter(r => r.ok).length, failed = results.filter(r => !r.ok);
  console.log(`${passed}/${results.length} kontrol PROŠLO`);
  if (failed.length) { console.log(`\n❌ SELHALO (${failed.length}):`); failed.forEach(f => console.log(`   • ${f.l}`)); }
  else console.log('\n🎉 VŠE PROŠLO');
}
main().then(() => pool.end()).catch(async e => { console.error('\n💥', e.message); await pool.end(); process.exit(1); });
