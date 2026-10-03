// E2E 11: provozni cesty, ktere v session 1 zustaly NEOVERENE — POS/pokladna, comps,
// guestlist (add + checkin), 2FA (setup→verify→enforce), self-refund po povoleni promoterem.
// Vse pres HTTP; ground truth z DB pres owner (bypass RLS).
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client, q, owner, check, ev, startLog, summary, gopayLog } from './lib.mjs';

startLog('11_operations');
const S = JSON.parse(readFileSync(new URL(process.env.AUDIT_STATE ?? './state.json', import.meta.url), 'utf8'));
const login = async (email, extra) => { const c = new Client('u'); const r = await c.post('/api/auth/login', { email, password: S.pw, ...extra }); return { c, r }; };
const PA = (await login(S.promoterA.email)).c;

// --- TOTP (shodne s src/lib/totp/verify.ts: SHA1, step 30, 6 digit) ---
function base32Decode(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, val = 0; const out = [];
  for (const ch of s.replace(/=+$/,'').toUpperCase()) { const i = A.indexOf(ch); if (i < 0) continue; val = (val << 5) | i; bits += 5; if (bits >= 8) { bits -= 8; out.push((val >>> bits) & 0xff); } }
  return Buffer.from(out);
}
function totp(secretRaw, at = Date.now()) {
  const counter = BigInt(Math.floor(at / 1000 / 30)); const buf = Buffer.alloc(8); buf.writeBigUInt64BE(counter);
  const h = createHmac('sha1', secretRaw).update(buf).digest(); const o = h[h.length - 1] & 0x0f;
  const bin = ((h[o] & 0x7f) << 24) | ((h[o+1] & 0xff) << 16) | ((h[o+2] & 0xff) << 8) | (h[o+3] & 0xff);
  return String(bin % 1e6).padStart(6, '0');
}

// ============ P: POS / pokladna ============
let r = await PA.post('/api/admin/pos/sale', { eventId: S.eventA, ticketTypeId: S.tt['Stani'], quantity: 2, buyerName: 'Pokladni Kupec', paymentMethod: 'cash' });
const posOrderId = r.json?.orderId ?? r.json?.order?.id ?? null;
const posTk = posOrderId ? await q(`SELECT status FROM tickets.tickets WHERE order_id=$1`, [posOrderId]) : [];
const posOrder = posOrderId ? (await q(`SELECT status, payment_provider FROM orders.orders WHERE id=$1`, [posOrderId]))[0] : null;
check('OP1', 'POS: pokladní prodej (cash) vystaví objednávku paid a 2 platné vstupenky', r.status === 200 && posTk.length === 2 && posTk.every((t) => t.status === 'valid') && posOrder?.status === 'paid', { status: r.status, body: JSON.stringify(r.json).slice(0, 200), order: posOrder, tickets: posTk.map((t) => t.status) });

// ============ C: comps (volné vstupenky) ============
r = await PA.post(`/api/admin/events/${S.eventA}/comps`, { ticketTypeId: S.tt['Stani'], recipientEmail: `press-${S.run}@audit.test`, recipientName: 'Novinar', compType: 'press', quantity: 1 });
const compOrderId = r.json?.orderId ?? r.json?.order?.id ?? null;
const compTk = compOrderId ? await q(`SELECT status FROM tickets.tickets WHERE order_id=$1`, [compOrderId]) : (await q(`SELECT t.status FROM tickets.tickets t JOIN orders.orders o ON o.id=t.order_id JOIN identity.users u ON u.id=o.user_id WHERE u.email=$1`, [`press-${S.run}@audit.test`]));
check('OP2', 'COMPS: promotér vystaví volnou (press) vstupenku, ticket valid', r.status < 300 && compTk.length >= 1 && compTk.some((t) => t.status === 'valid'), { status: r.status, body: JSON.stringify(r.json).slice(0, 200), tickets: compTk.map((t) => t.status) });

// ============ G: guestlist add + checkin ============
const gEmail = `guest-list-${S.run}@audit.test`;
r = await PA.post(`/api/admin/events/${S.eventA}/guestlist`, { guestName: 'Host Seznam', guestEmail: gEmail });
const gEntry = (await q(`SELECT id, ticket_id, status FROM orders.guestlist_entries WHERE event_id=$1 AND guest_email=$2`, [S.eventA, gEmail]))[0] ?? null;
check('OP3a', 'GUESTLIST: přidání hosta založí záznam + navázaný lístek', r.status < 300 && !!gEntry?.ticket_id, { status: r.status, body: JSON.stringify(r.json).slice(0, 200), entry: gEntry });
const ci = await PA.post(`/api/admin/events/${S.eventA}/guestlist/checkin`, { token: gEmail });
const gAfter = gEntry ? (await q(`SELECT status, checked_in_at FROM orders.guestlist_entries WHERE id=$1`, [gEntry.id]))[0] : null;
check('OP3b', 'GUESTLIST: check-in hosta (token=email) → status attended', ci.status === 200 && gAfter?.status === 'attended' && !!gAfter?.checked_in_at, { status: ci.status, body: JSON.stringify(ci.json).slice(0, 160), after: gAfter });

// ============ F: 2FA setup → verify → enforce na loginu ============
const admin2fa = (await login(S.adminEmail)).c;
const setup = await admin2fa.post('/api/admin/2fa/setup', {});
const secretB32 = setup.json?.secretBase32;
const secretRaw = secretB32 ? base32Decode(secretB32) : Buffer.alloc(0);
const code = secretRaw.length ? totp(secretRaw) : '000000';
const verify = await admin2fa.post('/api/admin/2fa/verify', { code });
const enabled = (await q(`SELECT enabled FROM identity.user_2fa u JOIN identity.users i ON i.id=u.user_id WHERE i.email=$1`, [S.adminEmail]))[0]?.enabled ?? false;
check('OP4a', '2FA: setup + verify správným TOTP → 2FA enabled v DB', setup.status === 200 && verify.status === 200 && enabled === true, { setup: setup.status, verify: verify.status, enabledInDb: enabled });
// login bez kódu musí být odmítnut, s kódem projít
const noCode = await new Client('nc').post('/api/auth/login', { email: S.adminEmail, password: S.pw });
const withCode = await new Client('wc').post('/api/auth/login', { email: S.adminEmail, password: S.pw, totpCode: totp(secretRaw) });
check('OP4b', '2FA: login bez kódu odmítnut (TOTP_REQUIRED/401), s platným kódem projde', noCode.status === 401 && noCode.json?.error === 'TOTP_REQUIRED' && withCode.status === 200, { noCode: noCode.status, noCodeErr: noCode.json?.error, withCode: withCode.status });
// úklid: vypnout 2FA, ať to neruší ostatní běhy
await q(`DELETE FROM identity.user_2fa WHERE user_id=(SELECT id FROM identity.users WHERE email=$1)`, [S.adminEmail]).catch(() => {});

// ============ R: self-refund po povolení promoterem ============
const gopayRefundsBefore = (await gopayLog()).filter((x) => /\/refund$/.test(x.path ?? '')).length;
const buyer = (await login(S.buyerEmail)).c;
// čerstvá zaplacená objednávka
const gopayCtl = async (id, body) => (await fetch(`${process.env.FAKE_GOPAY ?? 'http://localhost:3999'}/_ctl/${id}`, { method: 'POST', body: JSON.stringify(body) })).json();
const webhook = (pid) => new Client('gopay-notify').get(`/api/payments/gopay/webhook?id=${pid}`);
const co = await buyer.post('/api/checkout', { eventId: S.eventA, ticketTypeId: S.tt['Stani'], quantity: 1, buyerEmail: S.buyerEmail, buyerName: 'Kupec Audit' });
await gopayCtl(co.json.paymentId, { state: 'PAID' }); await webhook(co.json.paymentId);
let orderId = co.json.orderId; for (let i = 0; i < 40 && (await q(`SELECT 1 FROM tickets.tickets WHERE order_id=$1`, [orderId])).length === 0; i++) await new Promise((x) => setTimeout(x, 500));
// povolit self-refund pro promotéra A
await q(`INSERT INTO platform.refund_policies (promoter_id, allow_customer_self_refund) VALUES ($1, true)
         ON CONFLICT (promoter_id) DO UPDATE SET allow_customer_self_refund = true`, [S.promoterA.id]).catch(async (e) => {
  await q(`UPDATE platform.refund_policies SET allow_customer_self_refund=true WHERE promoter_id=$1`, [S.promoterA.id]);
});
r = await buyer.post(`/api/buyer/orders/${orderId}/refund`, { reason: 'audit self-refund' });
const od = (await q(`SELECT status FROM orders.orders WHERE id=$1`, [orderId]))[0];
const tks = await q(`SELECT status FROM tickets.tickets WHERE order_id=$1`, [orderId]);
const gopayRefundsAfter = (await gopayLog()).filter((x) => /\/refund$/.test(x.path ?? '')).length;
check('OP5a', 'SELF-REFUND: po povolení promotérem buyer self-refund uspěje, objednávka refunded/cancelled a vstupenky zneplatněny', r.status === 200 && ['refunded', 'cancelled'].includes(od?.status) && tks.every((t) => t.status !== 'valid'), { status: r.status, body: JSON.stringify(r.json).slice(0, 200), orderStatus: od?.status, tickets: tks.map((t) => t.status) });
check('OP5b', 'SELF-REFUND: peníze — self-refund zavolal refund u platební brány (očekáváno >0)', gopayRefundsAfter > gopayRefundsBefore, { gatewayRefundCallsDelta: gopayRefundsAfter - gopayRefundsBefore, note: 'stejná třída jako K2 — refund jen v DB' });

summary();
await owner.end();
