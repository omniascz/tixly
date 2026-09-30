// E2E 01: registrace/prihlaseni, role, zalozeni mista/akce/typu vstupenek/promo kodu, izolace tenantu.
// Vse pres HTTP; jedina SQL operace je povyseni 1 uzivatele na platform admina (seed) a cteni ground truth.
import { writeFileSync } from 'node:fs';
import { Client, q, owner, check, ev, startLog, summary } from './lib.mjs';

startLog('01_setup_roles');
const RUN = Date.now().toString(36);
const PW = 'Audit2026!x';
const S = { run: RUN, pw: PW };

// ---------- A. registrace / login ----------
const anon = new Client('anon');
const buyer = new Client('buyer');
S.buyerEmail = `buyer-${RUN}@audit.test`;
let r = await buyer.post('/api/auth/register', { email: S.buyerEmail, password: PW, name: 'Kupec Audit' });
check('A1', 'registrace zakaznika', r.status === 200 && !!r.json?.user?.id, ev(r));
S.buyerId = r.json?.user?.id;

r = await new Client('dup').post('/api/auth/register', { email: S.buyerEmail, password: PW, name: 'Dup' });
check('A2', 'duplicitni e-mail odmitnut (409)', r.status === 409, ev(r));
r = await new Client('weak').post('/api/auth/register', { email: `weak-${RUN}@audit.test`, password: '123', name: 'x' });
check('A3', 'slabe heslo odmitnuto (422)', r.status === 422, ev(r));

const b2 = new Client('buyer-login');
r = await b2.post('/api/auth/login', { email: S.buyerEmail, password: PW });
check('A4', 'login spravnym heslem', r.status === 200 && b2.cookies.size > 0, { ...ev(r), cookies: [...b2.cookies.keys()] });
r = await new Client('badpw').post('/api/auth/login', { email: S.buyerEmail, password: 'spatne-heslo-1' });
check('A5', 'login spatnym heslem odmitnut (401)', r.status === 401, ev(r));
const pwRow = await q(`SELECT (password_hash IS NOT NULL) AS in_users FROM identity.users WHERE id=$1`, [S.buyerId]);
const secRow = await q(`SELECT left(password_hash,4) AS prefix FROM identity.user_secrets WHERE user_id=$1`, [S.buyerId]).catch((e) => [{ err: e.message }]);
check('A6', 'heslo ulozeno jako bcrypt hash, ne plaintext', /^\$2[aby]\$/.test(secRow[0]?.prefix ?? ''), { users: pwRow[0], user_secrets: secRow[0] });

// ---------- B. platform admin (seed: SQL flag) ----------
const admin = new Client('platform-admin');
S.adminEmail = `padmin-${RUN}@audit.test`;
r = await admin.post('/api/auth/register', { email: S.adminEmail, password: PW, name: 'Platform Admin' });
await q(`UPDATE identity.users SET is_platform_admin = TRUE WHERE id = $1`, [r.json.user.id]);
r = await admin.post('/api/auth/login', { email: S.adminEmail, password: PW });
check('B1', 'platform admin login (role v JWT)', r.status === 200 && r.json?.roles?.isPlatformAdmin === true, ev(r));

// ---------- C. poradatele A a B ----------
async function mkPromoter(tag) {
  const c = new Client(`promoter-${tag}`);
  const email = `promoter-${tag}-${RUN}@audit.test`;
  const reg = await c.post('/api/auth/register-promoter', { email, password: PW, name: `Poradatel ${tag}`, companyName: `Audit ${tag} s.r.o.`, slug: `audit-${tag}-${RUN}` });
  const row = (await q(`SELECT p.id, p.status FROM platform.promoters p WHERE p.slug = $1`, [`audit-${tag}-${RUN}`]))[0];
  check(`C1${tag}`, `registrace poradatele ${tag}`, reg.status < 300 && !!row, { ...ev(reg), db: row });
  return { c, email, id: row?.id, status: row?.status };
}
const PA = await mkPromoter('a');
const PB = await mkPromoter('b');
S.promoterA = { email: PA.email, id: PA.id }; S.promoterB = { email: PB.email, id: PB.id };

for (const P of [PA, PB]) {
  const ap = await admin.post(`/api/platform/promoters/${P.id}/approve`);
  const st = (await q(`SELECT status FROM platform.promoters WHERE id=$1`, [P.id]))[0]?.status;
  check(`C2-${P.email[9]}`, `schvaleni poradatele platform adminem (pred: ${P.status})`, ap.status === 200 && st === 'active', { ...ev(ap), dbStatus: st });
  const lg = await P.c.post('/api/auth/login', { email: P.email, password: PW });
  check(`C3-${P.email[9]}`, 'login poradatele — membership v JWT', lg.status === 200 && (lg.json?.roles?.promoterMemberships?.length ?? 0) > 0, ev(lg));
}

// ---------- D. misto (platform admin) + akce (poradatel A) ----------
r = await admin.post('/api/platform/venues', { name: `Audit Sal ${RUN}`, city: 'Praha', country: 'CZ', capacity: 500, status: 'published' });
S.venueId = r.json?.id ?? r.json?.venue?.id;
check('D1', 'vytvoreni mista (platform admin)', r.status < 300 && !!S.venueId, ev(r));

const in30 = new Date(Date.now() + 30 * 864e5).toISOString();
const in30e = new Date(Date.now() + 30 * 864e5 + 3 * 36e5).toISOString();
async function mkEvent(P, title, ticketTypes) {
  const res = await P.c.post('/api/admin/events', { title, description: 'Auditni koncert — testovaci akce.', category: 'music', dateStart: in30, dateEnd: in30e, venueId: S.venueId, currency: 'CZK', ticketTypes });
  const id = res.json?.id ?? res.json?.event?.id ?? res.json?.eventId;
  const db = id ? (await q(`SELECT status, promoter_id FROM catalog.events WHERE id=$1`, [id]))[0] : null;
  return { res, id, db };
}
let e = await mkEvent(PA, `Audit Koncert A ${RUN}`, [
  { name: 'Stani', priceHalire: 50000, capacity: 50 },
  { name: 'Posledni mista', priceHalire: 30000, capacity: 5 },
  { name: 'Limit 2 na osobu', priceHalire: 20000, capacity: 100, maxPerUser: 2 },
  { name: 'Zdarma', priceHalire: 0, capacity: 10 },
]);
S.eventA = e.id;
check('D2', 'vytvoreni akce + 4 typy vstupenek (poradatel A)', e.res.status < 300 && !!e.id, { ...ev(e.res), db: e.db });
const tts = e.id ? await q(`SELECT id, name, base_price, total_qty, remaining_qty, max_per_user FROM catalog.ticket_types WHERE event_id=$1 ORDER BY base_price DESC`, [e.id]) : [];
check('D3', 'typy vstupenek v DB se spravnou cenou a kapacitou', tts.length === 4 && tts.every((t) => t.total_qty === t.remaining_qty), tts);
S.tt = Object.fromEntries(tts.map((t) => [t.name, t.id]));

e = await mkEvent(PB, `Audit Koncert B ${RUN}`, [{ name: 'Stani B', priceHalire: 40000, capacity: 20 }]);
S.eventB = e.id;
check('D4', 'vytvoreni akce poradatelem B', e.res.status < 300 && !!e.id, { ...ev(e.res), db: e.db });
S.ttB = e.id ? (await q(`SELECT id FROM catalog.ticket_types WHERE event_id=$1`, [e.id]))[0]?.id : null;

// stav publikace
for (const [k, id] of [['A', S.eventA], ['B', S.eventB]]) {
  const st = (await q(`SELECT status FROM catalog.events WHERE id=$1`, [id]))[0]?.status;
  check(`D5${k}`, `stav akce ${k} po vytvoreni`, null, { status: st });
  S[`eventStatus${k}`] = st;
}

// promo kod
r = await PA.c.post('/api/admin/promo-codes', { code: `AUDIT20${RUN}`.toUpperCase(), type: 'percentage', discountValue: 20, maxUses: 3 });
S.promo = `AUDIT20${RUN}`.toUpperCase();
const promoDb = await q(`SELECT * FROM marketing.promo_codes WHERE upper(code)=$1`, [S.promo]).catch((er) => [{ err: er.message }]);
check('D6', 'vytvoreni slevoveho kodu 20 % (max 3 pouziti)', r.status < 300 && promoDb.length === 1 && !promoDb[0].err, { ...ev(r), db: promoDb[0] });

// ---------- E. odmitnuti pristupu ----------
r = await anon.get('/api/admin/events');
check('E1', 'neprihlaseny -> /api/admin/events odmitnut', r.status === 401 || r.status === 403, ev(r));
r = await b2.get('/api/admin/events');
check('E2', 'zakaznik -> /api/admin/events odmitnut (403)', r.status === 403 || r.status === 401, ev(r));
r = await PA.c.get('/api/platform/promoters');
check('E3', 'poradatel -> /api/platform/* odmitnut (403)', r.status === 403 || r.status === 401, ev(r));
r = await PB.c.get(`/api/admin/events/${S.eventA}`);
check('E4', 'poradatel B cte akci poradatele A -> odmitnuto (403/404)', r.status === 403 || r.status === 404, ev(r));
r = await PB.c.patch(`/api/admin/events/${S.eventA}`, { title: 'HACKED by B' });
const titleA = (await q(`SELECT title FROM catalog.events WHERE id=$1`, [S.eventA]))[0]?.title;
check('E5', 'poradatel B meni akci A -> odmitnuto a title v DB nezmenen', (r.status === 403 || r.status === 404) && !/HACKED/.test(titleA), { ...ev(r), titleInDb: titleA });
r = await PB.c.post(`/api/admin/events/${S.eventA}/ticket-types`, { name: 'Cizi typ', priceHalire: 1, totalQty: 1000 });
const cnt = (await q(`SELECT count(*)::int n FROM catalog.ticket_types WHERE event_id=$1`, [S.eventA]))[0].n;
check('E6', 'poradatel B pridava typ vstupenky do akce A -> odmitnuto, pocet typu = 4', (r.status === 403 || r.status === 404) && cnt === 4, { ...ev(r), ticketTypesInDb: cnt });
r = await PB.c.get('/api/admin/events');
const leak = JSON.stringify(r.json ?? '').includes(S.eventA);
check('E7', 'seznam akci poradatele B neobsahuje akci A', r.status === 200 && !leak, { status: r.status, containsEventA: leak });
r = await PB.c.get('/api/admin/promo-codes');
check('E8', 'poradatel B nevidi promo kod poradatele A', r.status === 200 && !JSON.stringify(r.json ?? '').includes(S.promo), { status: r.status, body: JSON.stringify(r.json).slice(0, 200) });

writeFileSync(new URL('./state.json', import.meta.url), JSON.stringify(S, null, 2));
summary();
await owner.end();
